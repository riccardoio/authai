# Installation

Deploy one AuthAI relay per app environment. Each relay needs HTTPS, persistent storage, a JWT signing secret, an identity hashing secret, and a public URL your frontend and backend can both reach. For wiring the SDKs into your app, see [integration.md](./integration.md).

## What you're installing

The **relay** is a small Hono HTTP server that:

1. Runs the OAuth device-code flow against ChatGPT, Grok, or GitHub Copilot.
2. Encrypts each user's OAuth tokens with a per-record AES-256-GCM key.
3. Issues a session JWT to the client (the key lives in the JWT, never on the server).
4. Speaks OpenAI's wire format on `/v1/chat/completions`, `/v1/responses`, `/v1/models`. Routes each call to whichever provider the user signed in with.
5. Exposes `/auth/whoami` so your backend can identify the calling user without ever seeing OAuth tokens.

## Prerequisites

- Node.js **≥ 22**
- pnpm **≥ 9** (or npm / yarn; the repo uses pnpm workspaces)
- `openssl` (for generating secrets)

## Clone and install

```bash
git clone <repo-url>
cd authai
pnpm install
```

> AuthAI's packages are not yet published to npm. Until they are, clone the monorepo and use the workspace.

## Configure

Generate secrets **once per environment** and store them in your platform's secret manager. Do not regenerate them on every deploy — rotating either secret breaks user sessions (see [Rotating secrets](#rotating-secrets)).

```bash
cat > apps/relay-server/.env <<EOF
AUTH_AI_JWT_SECRET=$(openssl rand -hex 32)
AUTH_AI_IDENTITY_SECRET=$(openssl rand -hex 32)
AUTH_AI_ORIGINATOR=my-app
AUTH_AI_DB_DRIVER=sqlite
AUTH_AI_DB_URL=./relay.db
AUTH_AI_PORT=3000
EOF
```

### Env reference

| Variable                  | Required | Purpose                                                                                            |
| ------------------------- | -------- | -------------------------------------------------------------------------------------------------- |
| `AUTH_AI_JWT_SECRET`      | yes      | HS256 signing secret for session JWTs. 32+ bytes hex.                                              |
| `AUTH_AI_IDENTITY_SECRET` | yes      | HMAC-SHA256 secret for hashing user account IDs. 32+ bytes hex. **Must differ from JWT_SECRET.**   |
| `AUTH_AI_ORIGINATOR`      | yes      | App name shown on the provider consent screens (ChatGPT, Grok, GitHub).                            |
| `AUTH_AI_DB_DRIVER`       | no       | `sqlite` (default). A `postgres` driver is planned but not currently shipped.                      |
| `AUTH_AI_DB_URL`          | no       | SQLite path (`./relay.db`) or a future Postgres URL.                                               |
| `AUTH_AI_PORT`            | no       | HTTP port. Defaults to `3000`.                                                                     |

> **Why two secrets?** A leak of one shouldn't compromise the other. `JWT_SECRET` lets an attacker forge session tokens. `IDENTITY_SECRET` lets an attacker dictionary-attack stored account-id hashes against guessed provider IDs (notably GitHub numeric IDs). Keep them independent so a partial breach gives partial damage.

## Run

```bash
pnpm dev:relay
# AuthAI relay listening on http://localhost:3000
```

Verify:

```bash
curl http://localhost:3000/
# {"ok":true,"service":"authai-relay"}
```

A full sign-in cycle is then driven from a browser by `@authai/react` — see [integration.md](./integration.md) for the frontend wiring. The relay's `/auth/start` and `/auth/poll/:sessionId` endpoints are designed to be polled by that SDK, not by hand.

## Security properties

- **Encrypted at rest.** OAuth access + refresh tokens live in SQLite as AES-256-GCM ciphertext. The encryption key for each record is only in that user's JWT. A full DB dump alone cannot decrypt anything.
- **Forgery vs decryption isolated.** Forging session JWTs requires `JWT_SECRET`. Decrypting blobs requires per-user keys (in JWTs). One leak ≠ total compromise.
- **Identity hashed.** User IDs returned by `/auth/whoami` are `base64url(HMAC-SHA256(IDENTITY_SECRET, provider || \0 || accountId))`. Opaque, stable, provider-namespaced.
- **Uniform 401.** Every auth failure mode (missing JWT, bad signature, expired, revoked record, decryption failure, provider mismatch) returns the same `{"error":"unauthorized"}`. No record-existence or decryption oracle.

The full threat model is in [security.md](./security.md).

## Deploying

The relay is a stateless Hono server. SQLite makes it single-instance by default; horizontal scaling needs a shared `AuthRecordStore`, which today means waiting on the Postgres driver or writing your own.

### Fly.io (single instance, SQLite)

```bash
fly launch --name my-authai-relay
fly volumes create relay_data --size 1 --region <region>
# In fly.toml, mount /data and set AUTH_AI_DB_URL=/data/relay.db
fly secrets set \
  AUTH_AI_JWT_SECRET=$(openssl rand -hex 32) \
  AUTH_AI_IDENTITY_SECRET=$(openssl rand -hex 32) \
  AUTH_AI_ORIGINATOR=my-app
fly deploy
```

### Docker (minimal example, not optimized)

```dockerfile
FROM node:22-slim
WORKDIR /app
COPY . .
RUN corepack enable && pnpm install --frozen-lockfile
EXPOSE 3000
CMD ["pnpm", "--filter", "@authai/relay-server", "start"]
```

For production, add a `.dockerignore`, a multi-stage build that filters install to the relay workspace, and a non-root user.

```bash
docker run -p 3000:3000 \
  -e AUTH_AI_JWT_SECRET=... \
  -e AUTH_AI_IDENTITY_SECRET=... \
  -e AUTH_AI_ORIGINATOR=my-app \
  -e AUTH_AI_DB_URL=/data/relay.db \
  -v relay_data:/data \
  authai-relay
```

### Verifying production

```bash
curl https://your-relay.example/
# {"ok":true,"service":"authai-relay"}

curl -X POST https://your-relay.example/auth/start \
  -H "Content-Type: application/json" \
  -d '{"provider":"openai"}'
# {"sessionId":"...","provider":"openai","userCode":"...","verificationUrl":"https://auth.openai.com/codex/device",...}
```

After `/auth/start`, the browser SDK polls `/auth/poll/:sessionId` while the user completes the provider device-code flow. The complete client-driven flow is documented in [integration.md](./integration.md).

## Rotating secrets

### `JWT_SECRET`

Rotating invalidates every active AuthAI session immediately. Encrypted records remain in storage, but clients need new JWTs to decrypt and use them, which means every user has to sign in again. There is no rolling-rotation support today.

### `IDENTITY_SECRET`

Rotating changes the `user.id` value returned for every account on the next sign-in. If your app's database keys off `user.id`, those records are now orphaned.

**Important:** to compute the new `user.id` ahead of time, you would need each affected provider account ID — which `@authai/server` never gives you. If your app does not separately store provider account IDs, **`IDENTITY_SECRET` rotation is effectively an identity reset**: you'll need a migration plan or a separate user mapping. Treat this rotation as a planned event, not an operational rotation.

For an MVP demo with one or two test users, both rotations are safe: re-sign in, wipe the DB if you want to start clean.
