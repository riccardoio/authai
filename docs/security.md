# Security

AuthAI stores provider OAuth tokens, so the security boundary matters. This page describes where tokens live, what a leaked database exposes, what a leaked JWT exposes, what AuthAI does not protect against, and the operational baseline a production deployment needs.

## TL;DR

- **OAuth tokens are encrypted at rest with a per-record AES-256-GCM key.** That key is in the user's session JWT and is **never persisted server-side**. The relay cannot decrypt stored OAuth tokens from the database alone; it needs the user's JWT for that record.
- **User identity is hashed with HMAC-SHA256**, namespaced per provider, keyed by a separate secret. A DB leak does not let an attacker dictionary-attack provider account IDs.
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

Implementation: [`packages/relay/src/crypto.ts`](../packages/relay/src/crypto.ts), [`packages/relay/src/jwt.ts`](../packages/relay/src/jwt.ts).

## Sign-in flow

The protocol view:

```
end-user browser              AuthAI relay                    provider (ChatGPT / Grok / GitHub)
       │                            │                                       │
       │  POST /auth/start          │                                       │
       │ ─────────────────────────► │  device code request                  │
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
       │ ◄───────────────────────── │
       │  { status: "complete",     │
       │    jwt: "…" }              │
```

The relay's write transaction on a successful sign-in:

1. `K ← randomBytes(32)` — fresh per-record AES key
2. `iv ← randomBytes(12)` — fresh GCM nonce
3. `accountIdHash ← HMAC-SHA256(IDENTITY_SECRET, prov || \0 || accountId)`
4. `blob ← AES-256-GCM(K, iv, { access, refresh, accountId, originator })`
5. `INSERT INTO auth_records (rid, iv, blob, accountIdHash, …)` — `K` is not persisted
6. `JWT ← HS256-sign({ v:2, rid, k:base64url(K), prov, iat, exp:+14d })`

After this transaction, the relay has only the ciphertext. `K` is exclusively in the JWT, which lives in the user's browser (default `localStorage` via `@authai/react`).

Implementation: [`packages/relay/src/auth-routes.ts`](../packages/relay/src/auth-routes.ts) (`/start`, `/poll/:sessionId`).

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

The OAuth tokens never leave the relay process. Your backend sees the AuthAI JWT. It is opaque to the backend, but it is still a bearer credential: anyone who obtains it can use that user's AuthAI session until expiry or revocation.

Implementation: [`packages/relay/src/v1-routes.ts`](../packages/relay/src/v1-routes.ts), [`packages/relay/src/refresh.ts`](../packages/relay/src/refresh.ts).

## /auth/whoami flow

```
your backend                   AuthAI relay
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

Implementation: [`packages/relay/src/auth-routes.ts`](../packages/relay/src/auth-routes.ts) (`/whoami`).

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

> `accountIdHash` is stored as the HMAC output, not as the raw provider account ID. It may be loaded from disk during a sign-in dedup check or recomputed during a fresh sign-in; it is never reversed back to the provider account ID on disk.

## Token refresh

When the provider's `access_token` is within 60 s of expiry, the relay rotates it transparently:

1. Decrypt the blob with `K` (from the incoming JWT).
2. POST to the provider's `oauth/token` endpoint with `grant_type=refresh_token`.
3. Re-encrypt the new `{access, refresh, expires, accountId, originator}` with the **same `K`**.
4. Update the SQLite row in place.
5. Continue the original request.

The user's JWT does not change. Refresh is invisible to the client.

GitHub Copilot is a special case: GitHub device-code tokens don't have a refresh flow, but the Copilot internal token is short-lived (~30 min). The relay exchanges `github_access_token → copilot_api_token` on demand, caches the result in-memory keyed by `SHA-256(github_access_token)`, and refreshes ~5 min before expiry.

Implementation: [`packages/relay/src/refresh.ts`](../packages/relay/src/refresh.ts), [`packages/relay/src/providers/github-copilot/index.ts`](../packages/relay/src/providers/github-copilot/index.ts).

## Threat model

| Attack scenario                                                | Outcome                                                                                                          |
| -------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| **Full SQLite dump leaked**                                    | Blobs unreadable. Keys (`K`) are only in user JWTs, not on disk.                                                  |
| **Relay secret leak incl. `JWT_SECRET`** (env, secret manager, logs, crash dumps, filesystem) | Attacker can forge new JWTs but still has no `K` for existing records — pre-leak users' tokens stay encrypted.   |
| **Relay secret leak incl. `IDENTITY_SECRET`**                  | Attacker can dictionary-attack `accountIdHash`s in the DB by guessing provider IDs (notably GitHub numeric IDs). Does not decrypt tokens. |
| **Relay secret leak incl. BOTH secrets and the DB**            | Attacker can forge JWTs and reverse identity hashes. Still cannot decrypt existing blobs without per-user `K`. New users signing in against the still-compromised relay would expose `K` to the attacker. |
| **One user's JWT exfiltrated (XSS on your app)**               | That user's `K` is exposed; attacker can drive their session until JWT expires or it's revoked via `POST /auth/revoke`. Other users are unaffected. |
| **Relay process compromise (RCE / RAM read)**                  | Runtime compromise exposes decrypted tokens and per-record keys for requests handled during the compromise window. |
| **Your backend compromise**                                    | Attacker can intercept JWTs flowing through. Same blast radius as a builder-side session leak.                  |
| **Provider compromise (ChatGPT / GitHub / xAI breach)**        | Out of scope. AuthAI cannot defend against the provider itself being breached.                                   |
| **Network adversary between user ↔ relay**                     | Blocked by TLS. The verification URL is HTTPS-only.                                                              |
| **Network adversary between your backend ↔ relay**             | Blocked by TLS.                                                                                                  |
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

## Operational baseline

AuthAI's cryptographic story is only as good as the platform you run it on. Before you ship to users:

- **Terminate TLS** in front of the relay. The relay does not speak HTTP/HTTPS itself; put it behind a reverse proxy or a managed platform that handles certificates.
- **Store `JWT_SECRET` and `IDENTITY_SECRET` in your platform's secret manager.** Not in repo, not in image layers, not in `.env` files committed anywhere.
- **Do not log `Authorization` headers.** Strip them in your reverse proxy and your application loggers.
- **Restrict database access** to the relay's runtime identity. Even if `IDENTITY_SECRET` is well-kept, a leaked DB is a worse incident if it's readable from elsewhere in your network.
- **Patch dependencies regularly.** The relay uses Hono, jose, better-sqlite3, and a handful of standard libs. CVEs in any of them are your problem.
- **Apply rate limits** at the edge. `/auth/start` and `/v1/*` are both worth limiting per-IP and per-JWT.
- **Prevent XSS in your frontend.** The JWT is in `localStorage` by default. A script-injection on your page reads it. CSP, sanitization, and `storage="memory"` are your defenses.

These are baseline expectations, not an exhaustive checklist.

## Limitations

- **Runtime memory.** A relay process with RCE-level access can read `K` and the decrypted tokens during request processing. Operational defenses (sandboxing, process isolation, minimal blast radius) make this less likely, but cannot eliminate it.
- **Your backend trust.** Your backend sees JWTs from your users. A compromised backend gives an attacker the same access as a malicious backend would have anyway.
- **Provider trust.** AuthAI cannot constrain what the provider itself does with the user's account.
- **JWT lifetime tradeoff.** Default 14 days. Shorter = users re-auth more often. Longer = wider exfiltration window. Configurable in `packages/relay/src/jwt.ts` (`JWT_LIFETIME_SECONDS`).
- **No replay protection beyond expiry.** A leaked JWT works for its remaining lifetime unless explicitly revoked. There is no nonce or proof-of-possession.

## Migration & rotation

### Rotating `JWT_SECRET`

Invalidates every active session. All users have to sign in again. The encrypted blobs are still valid; new sign-ins will replace the old records (deduped via `accountIdHash`). There is no rolling-rotation support today.

### Rotating `IDENTITY_SECRET`

Changes `user.id` for every account on the next sign-in. If your app's database keys off `user.id`, those records are now orphaned.

**Important:** to precompute the new `user.id` values ahead of time, you would need each affected provider account ID — which `@authai/server` never gives you (it only returns the hashed `user.id`). If your app does not separately store provider account IDs, **`IDENTITY_SECRET` rotation is an identity reset, not a key rotation**. Treat it as a planned event with a migration plan, not an operational rotation.

For an MVP demo with one or two test users, both rotations are safe: re-sign in, wipe the DB if you want to start clean.

### Adding a new provider

A new provider only needs to wire `requestDeviceCode`, `pollDeviceCode`, `refreshTokens`, `listModels`, and `proxyChatCompletions`. The crypto and identity layers are provider-agnostic. See `packages/relay/src/providers/` for examples.
