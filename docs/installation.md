# Installation

Self-host the AuthAI relay. For wiring the SDKs into your app, see [integration.md](./integration.md).

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
git clone https://github.com/your-org/authai
cd authai
pnpm install
```

## Configure

Create `apps/relay-server/.env`:

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
| `AUTH_AI_DB_DRIVER`       | no       | `sqlite` (default). `postgres` planned.                                                            |
| `AUTH_AI_DB_URL`          | no       | SQLite path (`./relay.db`) or Postgres URL.                                                        |
| `AUTH_AI_PORT`            | no       | HTTP port. Defaults to `3000`.                                                                     |

> **Why two secrets?** A leak of one shouldn't compromise the other. `JWT_SECRET` forges sessions; `IDENTITY_SECRET` reverses user IDs. Keep them independent so a partial breach gives the attacker partial damage.

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

## Security properties

- **Encrypted at rest.** OAuth access + refresh tokens live in SQLite as AES-256-GCM ciphertext. The encryption key for each record is only in that user's JWT. A full DB dump alone cannot decrypt anything.
- **Forgery vs decryption isolated.** Forging session JWTs requires `JWT_SECRET`. Decrypting blobs requires per-user keys (in JWTs). One leak ≠ total compromise.
- **Identity hashed.** User IDs returned by `/auth/whoami` are `base64url(HMAC-SHA256(IDENTITY_SECRET, provider || \0 || accountId))`. Opaque, stable, provider-namespaced.
- **Uniform 401.** Every auth failure mode (missing JWT, bad signature, expired, revoked record, decryption failure, provider mismatch) returns the same `{"error":"unauthorized"}`. No record-existence or decryption oracle.

## Deploying

The relay is a stateless Hono server. SQLite makes it single-instance by default; switch to Postgres for horizontal scaling.

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

### Docker

```dockerfile
FROM node:22-slim
WORKDIR /app
COPY . .
RUN corepack enable && pnpm install --frozen-lockfile
EXPOSE 3000
CMD ["pnpm", "--filter", "@authai/relay-server", "start"]
```

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
curl https://your-relay.com/
# {"ok":true,"service":"authai-relay"}

curl -X POST https://your-relay.com/auth/start \
  -H "Content-Type: application/json" \
  -d '{"provider":"openai"}'
# {"sessionId":"...","provider":"openai","userCode":"...","verificationUrl":"https://auth.openai.com/codex/device", ...}
```

## Rotating secrets

Rotating `JWT_SECRET` invalidates every active session — all users have to sign in again.

Rotating `IDENTITY_SECRET` changes every user's `user.id` going forward. If your app keyed records by `user.id`, those records are now orphaned. Plan a migration before rotating.

For an MVP demo with one test user, both rotations are safe (re-sign in, wipe the DB if needed).
