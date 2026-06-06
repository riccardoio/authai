# Design — AuthAI v2 (encrypted token storage, self-hostable)

## Scope

v2 is self-hosted only. We ship one open-source relay anyone can clone, configure, and run. The public demo at `relay.authai.dev` (whenever it exists) is just a deployed instance of that same code. We are not building a SaaS, we are not signing app developers up, and we are not handling end-user OpenAI tokens for them — that's the point of the encryption model.

A cloud/multitenant edition can be added later as its own package boundary; it is explicitly not part of v2.

## Why v2

v1 ships raw OAuth tokens to the client. Anyone who reads the user's localStorage gets full access to that user's ChatGPT subscription until the token expires. v2 fixes that with a split-key model: a per-record symmetric key is issued to the client in a JWT, only the encrypted blob lives server-side, and both pieces are required to use the credential. Even a complete DB dump or full server filesystem leak does not let an attacker decrypt user tokens.

The second goal is making integration trivial for an existing project. Drop in a sign-in component, get a JWT back, point the official `openai` SDK at the relay using that JWT as the apiKey. Existing model-call code is unchanged.

## Architecture

```
end-user browser
    │  jwt (however the app wants to transport it)
    ▼
app builder's backend (api.example.com)
    │  new OpenAI({ apiKey: jwt, baseURL: relay/v1 })
    │  uses openai.* normally
    ▼
AuthAI relay
    │  - verify jwt (HS256)
    │  - extract { record_id, K }
    │  - decrypt blob with K → { access, refresh, accountId }
    │  - translate request → Codex Responses
    │  - call chatgpt.com/backend-api/codex/responses
    │  - refresh tokens server-side on expiry, re-encrypt blob with same K
    ▼
chatgpt.com/backend-api/codex/responses
```

The relay is the only component that ever sees plaintext OAuth tokens. The client only ever holds a JWT. The builder's backend only forwards the JWT.

## Security model

### Sign-in

1. Relay completes OAuth (device code flow, same as v1).
2. Relay generates a fresh 32-byte AES-256 key `K` and a 12-byte AES-GCM IV.
3. `blob = AES-256-GCM(K, iv, { access, refresh, accountId, originator })`.
4. Relay inserts `{ id: ULID, iv, blob, account_id_hash, created_at, updated_at, expires_at }`.
5. Relay issues a JWT to the client: `{ v: 1, rid, k: base64url(K), iat, exp }`, signed HS256 with `AUTH_AI_JWT_SECRET`.

`K` is never persisted server-side. It only lives in the user's JWT. `account_id_hash = SHA-256(accountId)` enables dedup on re-sign-in (same ChatGPT account → reuse the same record).

### Per request

1. Builder's backend sends an OpenAI-compatible request to `relay/v1/...` with `Authorization: Bearer <jwt>`.
2. Relay verifies the JWT signature, extracts `{ rid, k }`.
3. Relay loads the blob by `rid`, decrypts with `K` to recover `{ access, refresh, accountId, originator }`.
4. If `access` is expired or within 60s of expiry: refresh via `auth.openai.com/oauth/token`, re-encrypt the new tokens with the same `K`, update the blob in place. JWT is not rotated.
5. Translate the request to a Codex Responses call, stream the response back.

### Threat coverage

| Threat | Outcome |
|---|---|
| Full database leak | Blobs unreadable — no keys server-side |
| Full server filesystem leak (incl. JWT_SECRET, DB) | Still no per-record keys. JWT_SECRET lets attacker forge JWTs, but a forged JWT doesn't decrypt existing blobs without `K` |
| One user's JWT stolen via XSS | That user's quota usable until JWT expires; revoke via `POST /auth/revoke` |
| Server runtime RAM compromise | Lost — true for any system |
| Builder's backend pwned | Lost — JWTs flow through it. Their responsibility |

## Storage driver

Single small interface, two implementations:

```ts
interface AuthRecordStore {
  put(record: AuthRecord): Promise<void>;
  get(id: string): Promise<AuthRecord | null>;
  findByAccountHash(hash: string): Promise<AuthRecord | null>;
  update(id: string, patch: Partial<AuthRecord>): Promise<void>;
  delete(id: string): Promise<void>;
}
```

- `@authai/relay-store-sqlite` — default, single-file, zero infra.
- `@authai/relay-store-postgres` — for production deploys.

Driver picked by explicit env var:

```
AUTH_AI_DB_DRIVER=sqlite              # sqlite (default) | postgres
AUTH_AI_DB_URL=./relay.db             # sqlite path, or postgres://user:pass@host/db
```

A background sweep deletes expired records every ~5 minutes.

### Schema (SQLite; Postgres analogous)

```sql
CREATE TABLE auth_records (
  id               TEXT    PRIMARY KEY,    -- ULID
  iv               BLOB    NOT NULL,       -- 12 bytes
  blob             BLOB    NOT NULL,       -- AES-GCM ciphertext + tag
  account_id_hash  TEXT    NOT NULL,       -- SHA-256 hex
  created_at       INTEGER NOT NULL,
  updated_at       INTEGER NOT NULL,
  expires_at       INTEGER NOT NULL
);
CREATE INDEX auth_records_by_account ON auth_records (account_id_hash);
CREATE INDEX auth_records_by_expires ON auth_records (expires_at);
```

## Relay endpoints

```
Auth:
  POST   /auth/start              → { sessionId, userCode, verificationUrl, expiresInMs, pollIntervalMs }
  GET    /auth/poll/:sessionId    → { status: "pending" | "complete" | "expired" | "error", jwt?, error? }
  POST   /auth/revoke             → 204     (Authorization: Bearer <jwt>; deletes the bound record)

OpenAI-compatible (Authorization: Bearer <jwt>):
  GET    /v1/models               → known Codex model list
  POST   /v1/chat/completions     → Chat Completions wire, translated to Codex Responses internally
  POST   /v1/responses            → Responses wire, pass-through to chatgpt.com/backend-api/codex/responses
  any other /v1/*                 → 400 { error: { message: "Endpoint <path> not supported by Codex auth", type: "unsupported_endpoint" } }
```

Streaming uses SSE in both directions, matching the OpenAI SDK's expectations. The relay translates Codex Responses streaming events back to Chat Completions chunks for `/v1/chat/completions`.

## JWT

```jsonc
{
  "v":   1,
  "rid": "01HNYZ...",          // record id
  "k":   "<base64url 32 bytes>",
  "iat": 1733456789,
  "exp": 1734666389            // 14 days
}
```

- Algorithm: HS256.
- Signed with `AUTH_AI_JWT_SECRET`.
- Lifetime: 14 days. Server-side refresh of OpenAI tokens does not rotate the JWT.

## Workspace layout

```
packages/
├── relay/                shared core (OAuth flow, JWT, AES-GCM, OpenAI-compat proxy, store interface)
├── relay-store-sqlite/   default storage driver
├── relay-store-postgres/ optional (deferred — sqlite is enough for v2)
├── react/                <AuthAIProvider>, <SignInWithChatGPT>, useAuthAI
└── web/                  framework-agnostic equivalents (deferred — react is enough for v2)
apps/
├── relay-server/         boots the relay
├── example-react/        frontend demo
└── example-backend/      tiny Node backend showing the openai-SDK pattern
```

### Env contract

```
AUTH_AI_JWT_SECRET=<random 32+ bytes hex>      # required
AUTH_AI_DB_DRIVER=sqlite                       # sqlite (default) | postgres
AUTH_AI_DB_URL=./relay.db                      # or postgres://user:pass@host/db
AUTH_AI_ORIGINATOR=my-app                      # required; shown on the ChatGPT consent screen
AUTH_AI_PORT=3000
```

Self-host quickstart:

```bash
git clone https://github.com/<you>/authai && cd authai
cat > .env <<EOF
AUTH_AI_JWT_SECRET=$(openssl rand -hex 32)
AUTH_AI_DB_DRIVER=sqlite
AUTH_AI_DB_URL=./relay.db
AUTH_AI_ORIGINATOR=my-app
EOF
pnpm install && pnpm --filter @authai/relay-server start
# → relay on :3000
```

## Client SDK surface

We expose only one client-side primitive: the JWT.

### React

```tsx
import { AuthAIProvider, SignInWithChatGPT, useAuthAI } from "@authai/react";

<AuthAIProvider
  relayUrl="https://relay.authai.dev"
  storage="localStorage"        // "localStorage" | "memory" | custom adapter
>
  <App />
</AuthAIProvider>;

<SignInWithChatGPT>Sign in with ChatGPT</SignInWithChatGPT>;

const { jwt, isSignedIn, signIn, signOut } = useAuthAI();
// app sends `jwt` to its backend however it normally sends auth
```

That's the entire client API. No model-call helpers, no openai-client wrapper, no token-handling APIs. The app's backend uses the official `openai` package directly.

## Backend integration (no SDK from us)

The official `openai` package, unchanged:

```ts
import OpenAI from "openai";

const openai = new OpenAI({
  apiKey:  jwtFromIncomingRequest,
  baseURL: `${process.env.AUTH_AI_RELAY_URL}/v1`,
});

const completion = await openai.chat.completions.create({
  model: "gpt-5.4",
  messages: [{ role: "user", content: "hi" }],
});
```

Embeddings, vision, batch, assistants, fine-tunes, audio — all return the structured "not supported by Codex auth" error.

## Migration from v1

v1 used the working name `chatgpt-connect` and `@ai-connect/*` packages. v2 is rebranded **AuthAI** (library: `authai`, packages `@authai/*`, env prefix `AUTH_AI_`). The v1 spec stays under `docs/design.md`. v2 is a real refactor that replaces v1 in place:

- v1 `packages/sdk` is deleted. `@authai/react` is a fresh implementation that exposes only the JWT.
- Relay endpoints: `/auth/poll/:id` returns `{ jwt }` not `{ tokens }`; new `/auth/revoke`; new `/v1/*` OpenAI-compatible routes.
- Relay gains storage layer, AES-GCM encrypt/decrypt, JWT issuance.
- Example app: removes the bespoke `<Chat />` UI from v1 and demonstrates the new pattern — frontend signs in, hands the JWT to `example-backend/` which uses `openai` directly against the relay.

## Out of scope for v2

- Cloud edition (signup, dashboard, billing, multi-tenant originator) — separate future package.
- Postgres driver — interface exists; sqlite implementation is enough for v2.
- `@authai/web` framework-agnostic SDK — React is enough for v2.
- Express/Next/Hono middleware packages — the docs snippet is enough.

## Verification plan

1. Generate a JWT_SECRET, boot the relay with SQLite — `/` returns ok.
2. Sign in via the React example — `/auth/poll/:id` returns a JWT, not raw tokens. Decode and confirm `rid`, `k`, `exp`.
3. From `example-backend/`: `new OpenAI({ apiKey: jwt, baseURL: relay/v1 })`, call `openai.chat.completions.create({ model: "gpt-5.4", messages, stream: true })`. Verify the stream arrives in Chat Completions format.
4. Call an unsupported endpoint (e.g. `openai.embeddings.create`) — confirm structured 400 error.
5. Inspect the SQLite DB: blobs are opaque bytes, no plaintext OAuth tokens anywhere.
6. Sign with a different JWT_SECRET and retry the chat call — expect 401.
7. Force-refresh path: set the encrypted record's stored `expires_at` for the access token to past, call chat, verify the relay refreshes server-side and the blob is updated in place; JWT still works.

## File-by-file scope

Created or rewritten:

- `packages/relay/src/crypto.ts` — AES-256-GCM encrypt/decrypt.
- `packages/relay/src/jwt.ts` — issue, verify, parse session JWTs.
- `packages/relay/src/store.ts` — `AuthRecordStore` interface.
- `packages/relay/src/auth-routes.ts` — `/auth/poll/:id` issues a JWT; new `/auth/revoke`.
- `packages/relay/src/v1-routes.ts` — `/v1/models`, `/v1/chat/completions`, `/v1/responses`, unsupported-endpoint catch-all.
- `packages/relay/src/openai-translate.ts` — Chat Completions ↔ Codex Responses translation, streaming.
- `packages/relay/src/refresh.ts` — server-side token refresh + re-encrypt.
- `packages/relay-store-sqlite/` — new package.
- `packages/react/` — new package.
- `apps/relay-server/` — new app.
- `apps/example-react/` — rewritten to use `@authai/react`.
- `apps/example-backend/` — new tiny Node demo using `openai` against the relay.

Deleted:

- `packages/sdk/` (v1 SDK).
