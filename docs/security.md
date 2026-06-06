# Security

How AuthAI protects user OAuth tokens. This document covers the cryptographic primitives, the storage model, the per-request flow, and the threat model.

## TL;DR

- **OAuth tokens are encrypted at rest with a per-record AES-256-GCM key.** That key is in the user's session JWT and is **never persisted server-side**. A full database leak alone cannot decrypt any user's tokens.
- **User identity is hashed with HMAC-SHA256**, namespaced per provider, keyed by a separate secret. A DB leak does not let an attacker dictionary-attack provider account IDs (notably GitHub numeric IDs).
- **Every auth failure returns the same `401 unauthorized`.** No record-existence, key-validity, or provider-mismatch oracle.

## Cryptographic primitives

| Primitive          | Algorithm     | Purpose                                                       | Key location              |
| ------------------ | ------------- | ------------------------------------------------------------- | ------------------------- |
| Token encryption   | AES-256-GCM   | Encrypts the OAuth `{access, refresh, accountId, …}` blob.    | In the user's JWT (`k`).  |
| JWT signing        | HS256         | Signs session JWTs so the relay can authenticate them.        | Relay env: `AUTH_AI_JWT_SECRET`. |
| Identity hashing   | HMAC-SHA256   | Produces opaque, namespaced user IDs.                         | Relay env: `AUTH_AI_IDENTITY_SECRET`. |

- AES-GCM uses a fresh 12-byte random nonce per encrypt. The 16-byte auth tag is appended to the ciphertext.
- HS256 secret must be ≥ 32 bytes hex.
- Identity secret must be ≥ 32 bytes hex and **independent** from the JWT secret.

Implementation: `packages/relay/src/crypto.ts`, `packages/relay/src/jwt.ts`.

## Sign-in flow

```
end-user browser              AuthAI relay                    provider (ChatGPT / Grok / GitHub)
       │                            │                                       │
       │  POST /auth/start          │                                       │
       │ ─────────────────────────► │                                       │
       │                            │  device code request                  │
       │                            │ ─────────────────────────────────────►│
       │ ◄───────────────────────── │ ◄───────────────────────────────────  │
       │  { sessionId, userCode,    │  { deviceAuthId, userCode,            │
       │    verificationUrl, … }    │    verificationUrl, intervalMs }      │
       │                            │                                       │
       │  user visits verificationUrl, enters userCode                      │
       │ ────────────────────────────────────────────────────────────────► │
       │                            │                                       │
       │  GET /auth/poll/:sessionId │  POLL                                 │
       │ ─────────────────────────► │ ─────────────────────────────────────►│
       │                            │ ◄───────────────────────────────────  │
       │                            │  access + refresh tokens              │
       │                            │                                       │
       │                            │  Relay actions (atomic, in-memory):
       │                            │   1. K ← randomBytes(32)
       │                            │   2. iv ← randomBytes(12)
       │                            │   3. accountIdHash ← HMAC(IDENTITY_SECRET, prov || \0 || accountId)
       │                            │   4. blob ← AES-256-GCM(K, iv, { access, refresh, accountId, originator })
       │                            │   5. SQLite INSERT { rid: ULID, iv, blob, accountIdHash, … }
       │                            │   6. JWT ← HS256-sign({ v:2, rid, k:base64url(K), prov, iat, exp:+14d })
       │                            │
       │ ◄───────────────────────── │
       │  { status: "complete",     │
       │    jwt: "…" }              │
```

After this, the relay has only the ciphertext. `K` is exclusively in the JWT, which lives in the user's browser (default `localStorage` via `@authai/react`).

Implementation: `packages/relay/src/auth-routes.ts` `/start`, `/poll/:sessionId`.

## Per-request flow (model call)

```
end-user                  builder's backend                AuthAI relay              provider
   │                              │                            │                          │
   │  …jwt in Authorization…      │                            │                          │
   │ ────────────────────────────►│                            │                          │
   │                              │  POST /v1/chat/completions │                          │
   │                              │  Authorization: Bearer JWT │                          │
   │                              │ ──────────────────────────►│                          │
   │                              │                            │  1. HS256-verify JWT
   │                              │                            │  2. Load record by JWT.rid
   │                              │                            │  3. Verify JWT.prov === blob.prov
   │                              │                            │  4. AES-GCM-decrypt with JWT.k
   │                              │                            │  5. If access expiring, refresh
   │                              │                            │     and re-encrypt blob with same K
   │                              │                            │  6. Forward to provider's
   │                              │                            │     `/codex/responses` (or /v1/chat/completions for xAI/Copilot)
   │                              │                            │ ────────────────────────►│
   │                              │ ◄──────────────────────────│ ◄────────────────────────│
   │                              │                            │
   │ ◄────────────────────────────│  streamed response         │
```

The OAuth tokens never leave the relay process. The builder's backend sees only the JWT (opaque to it) and the model response stream.

Implementation: `packages/relay/src/v1-routes.ts`, `packages/relay/src/refresh.ts`.

## /auth/whoami flow

```
builder's backend             AuthAI relay
       │                            │
       │  GET /auth/whoami          │
       │  Authorization: Bearer JWT │
       │ ─────────────────────────► │
       │                            │  1. HS256-verify JWT
       │                            │  2. Load record by JWT.rid; if missing → 401
       │                            │  3. AES-GCM-decrypt blob with JWT.k
       │                            │  4. Verify blob.prov === JWT.prov; else 401
       │                            │  5. id ← HMAC(IDENTITY_SECRET, prov || \0 || blob.accountId)
       │                            │  6. Return { user: { id, provider }, session: { expires } }
       │                            │
       │ ◄───────────────────────── │
       │  { user: { id, provider }, │
       │    session: { expires } }  │
```

This endpoint:

- **Never proxies to the upstream provider.** No network calls outside the relay.
- **Never refreshes tokens.** GET is idempotent.
- **Never returns OAuth tokens.** Only the namespaced identity hash + JWT expiry.

Implementation: `packages/relay/src/auth-routes.ts` `/whoami`.

## What's stored where

| Item                          | Browser (JWT) | Relay process RAM (per-request) | SQLite (at rest) | Provider |
| ----------------------------- | :-----------: | :-----------------------------: | :--------------: | :------: |
| AES-256 key `K`               | ✓             | ✓ (during request only)         | ✗                | ✗        |
| OAuth `access_token`          | ✗             | ✓ (during request only)         | ✓ (encrypted)    | ✓        |
| OAuth `refresh_token`         | ✗             | ✓ (during request only)         | ✓ (encrypted)    | ✓        |
| Provider `accountId`          | ✗             | ✓ (during request only)         | ✓ (encrypted)    | ✓        |
| `accountIdHash` (HMAC)        | ✗             | ✓                               | ✓ (plaintext)    | ✗        |
| `provider`                    | ✓ (JWT.prov)  | ✓                               | ✓ (encrypted)    | n/a      |
| `record_id` (ULID)            | ✓ (JWT.rid)   | ✓                               | ✓ (plaintext)    | ✗        |
| `JWT_SECRET`                  | ✗             | ✓                               | ✗                | ✗        |
| `IDENTITY_SECRET`             | ✗             | ✓                               | ✗                | ✗        |

## Token refresh

When the provider's `access_token` is within 60 s of expiry, the relay rotates it transparently:

1. Decrypt the blob with `K` (from the incoming JWT).
2. POST to the provider's `oauth/token` endpoint with `grant_type=refresh_token`.
3. Re-encrypt the new `{access, refresh, expires, accountId, originator}` with the **same `K`**.
4. Update the SQLite row in place.
5. Continue the original request.

The user's JWT does not change. Refresh is invisible to the client.

GitHub Copilot is a special case: GitHub device-code tokens don't have a refresh flow, but the Copilot internal token is short-lived (~30 min). The relay exchanges `github_access_token → copilot_api_token` on demand, caches the result in-memory keyed by `SHA-256(github_access_token)`, and refreshes ~5 min before expiry.

Implementation: `packages/relay/src/refresh.ts`, `packages/relay/src/providers/github-copilot/index.ts`.

## Threat model

| Attack scenario                                                | Outcome                                                                                                          |
| -------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| **Full SQLite dump leaked**                                    | Blobs unreadable. Keys (`K`) are only in user JWTs, not on disk.                                                  |
| **Filesystem leak incl. `JWT_SECRET`**                         | Attacker can forge new JWTs but still has no `K` for existing records — pre-leak users' tokens stay encrypted.   |
| **Filesystem leak incl. `IDENTITY_SECRET`**                    | Attacker can dictionary-attack `accountIdHash`s in the DB to provider IDs. Doesn't decrypt tokens.               |
| **Filesystem leak incl. BOTH secrets and the DB**              | Attacker can forge JWTs and reverse identity hashes. Still cannot decrypt existing blobs without per-user `K`. New users who sign in against the still-compromised relay would expose `K` to the attacker. |
| **One user's JWT exfiltrated (XSS on the app)**                | That user's `K` is exposed; attacker can drive their session until JWT expires or it's revoked via `POST /auth/revoke`. Other users are unaffected. |
| **Relay process compromise (RCE / RAM read)**                  | Catastrophic for in-flight users — keys flow through memory during each request. True for any system handling secrets server-side. |
| **Builder backend compromise**                                 | Attacker can intercept JWTs flowing through. Same blast radius as a builder-side session leak.                  |
| **Provider compromise (ChatGPT / GitHub / xAI breach)**        | Out of scope. AuthAI cannot defend against the provider itself being breached.                                   |
| **Network adversary between user ↔ relay**                     | Blocked by TLS. The verification URL is HTTPS-only.                                                              |
| **Network adversary between builder backend ↔ relay**          | Blocked by TLS.                                                                                                  |
| **Replay of a leaked JWT against the relay**                   | Works until JWT expiry (default 14 days) or until revoked. Revocation is single-call: `POST /auth/revoke`.       |

## Uniform 401

Every authentication failure mode on `/auth/whoami` and `/v1/*` returns the **identical** response:

```json
HTTP/1.1 401 Unauthorized
{ "error": "unauthorized" }
```

This applies to:

- Missing `Authorization` header
- Malformed JWT
- Invalid signature
- Expired JWT
- Wrong JWT version
- Wrong key length
- Record not found (revoked or never existed)
- Decryption failure (wrong `K`)
- Provider mismatch between JWT and stored record

The distinction is preserved in server-side logs but never returned to the caller. This denies an attacker any oracle to:

- Enumerate `rid` values to test which records exist
- Test whether a given `K` decrypts a given `rid`
- Probe provider assignment across records

## Limitations

- **Runtime memory.** A relay process with RCE-level access can read `K` and the decrypted tokens during request processing. AuthAI does not defend against this — no server-side secrets system can. Operational defenses (sandboxing, process isolation, minimal blast radius) are out of scope here.
- **Builder backend trust.** The builder's backend sees JWTs from their users. A compromised builder backend gives an attacker the same access as a malicious builder backend would have anyway.
- **Provider trust.** AuthAI cannot constrain what the provider itself does with the user's account.
- **JWT lifetime tradeoff.** Default 14 days. Shorter = users re-auth more often. Longer = wider exfiltration window. Configurable in `packages/relay/src/jwt.ts` (`JWT_LIFETIME_SECONDS`).
- **No replay protection beyond expiry.** A leaked JWT works for its remaining lifetime unless explicitly revoked. There is no nonce / proof-of-possession.

## Migration & rotation

### Rotating `JWT_SECRET`

Invalidates every active session. All users have to sign in again. The encrypted blobs are still valid; new sign-ins will replace the old records (deduped via `accountIdHash`).

### Rotating `IDENTITY_SECRET`

Changes `user.id` for every account on the next sign-in. If your app's database keys off `user.id`, you'll see those records orphaned. To migrate:

1. Compute the new HMAC for each affected provider account ID.
2. Backfill your records with the new `user.id` values.
3. Then rotate the relay's secret.

For an MVP demo with a single user, both rotations are safe: re-sign in, wipe the DB if you want to start clean.

### Adding a new provider

A new provider only needs to wire `requestDeviceCode`, `pollDeviceCode`, `refreshTokens`, `listModels`, and `proxyChatCompletions`. The crypto and identity layers are provider-agnostic. See `packages/relay/src/providers/` for examples.
