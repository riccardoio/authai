# AuthAI: how it works under the hood

This page describes the moving parts of an AuthAI deployment. It's written for self-hosters and contributors who want to understand the wiring before changing it. The community edition (one relay, one tenant, SQLite) is the same code as the cloud edition (many tenants, Postgres, Redis, hosted at `relay.authai.dev` + a Next.js dashboard at `cloud.authai.dev`). Both share the crypto, JWT, and provider layers.

If you just want to use AuthAI in your app, [installation.md](./installation.md) and the README are the right places to start.

## Cloud edition: relay + webapp split

The cloud edition is two separate deployments that share Postgres:

| Process            | Deploy      | Domain               | Owns                                                |
| ------------------ | ----------- | -------------------- | --------------------------------------------------- |
| **cloud-relay-server** | Fly.io      | `relay.authai.dev`   | `/auth/*` (device-code, JWT), `/v1/*` (model proxy). Pure data plane. |
| **cloud-web**      | Vercel      | `cloud.authai.dev`   | Landing page, GitHub OAuth, dashboard, app CRUD, docs viewer, CLI bridge. Pure control plane. |

The relay reads the `apps` table. The webapp writes it. They share no code beyond `@authai/cloud` (resolver, kill switch, identity derivation) and `@authai/relay-store-postgres`. There is NO admin API on the relay.

```
                      ┌────────────────────────────────────┐
                      │ cloud.authai.dev  (Next.js, Vercel)│
   browser ──────────►│  • landing                          │
   (humans)           │  • GitHub OAuth (web flow)          │
                      │  • /dashboard, /apps/new            │
                      │  • /cli-init (bridge for npx flow)  │
                      │  • /docs                            │
                      └────────────────┬───────────────────┘
                                       │ writes apps table
                                       ▼
                          ┌────────────────────────┐
                          │  shared Postgres        │◄────┐
                          │  (auth_records,         │     │ reads apps
                          │   apps, audit_events)   │     │
                          └────────────────────────┘     │
                                       ▲                  │
                  reads tenants ───────┘                  │
                                                          │
                      ┌──────────────────────────────────┴─┐
   builder backend ──►│ relay.authai.dev  (Hono, Fly.io)   │
   end-user browser ─►│  • /auth/start, /auth/poll, /whoami │
                      │  • /v1/chat/completions, /v1/models │
                      │  • CloudTenantResolver, kill switch │
                      └────────────────────────────────────┘
```

## Editions at a glance

| Capability                         | Community (self-hosted) | Cloud (`cloud.authai.dev`) |
| ---------------------------------- | :---------------------: | :------------------------: |
| Sign in with ChatGPT / Copilot / xAI | ✓                       | ✓                          |
| Encrypted token storage             | ✓ SQLite                | ✓ Postgres                 |
| Multi-tenant (many apps in one relay) | —                     | ✓                          |
| `npx authai-cloud init` setup      | —                       | ✓                          |
| Origin verification (DNS TXT)      | —                       | ✓                          |
| Global cost-cap kill switch        | —                       | ✓                          |
| Per-app rate limits                | operator-supplied        | ✓ built-in (Redis)         |
| Consent dialog + per-app budgets   | —                       | (v2 — not in v1)           |
| `cloud.authai.dev/me` page         | —                       | (v2 — not in v1)           |

The crypto model is identical across editions. The cloud edition adds tenant-scoping on top.

## Crypto: split-key encryption

Every encrypted record uses three independent secrets. The host (whoever runs the relay) controls two of them; the third lives only in the user's JWT.

| Secret                  | Purpose                                             | Lives in                |
| ----------------------- | --------------------------------------------------- | ----------------------- |
| `AUTH_AI_JWT_SECRET`    | Signs and verifies session JWTs (HS256).            | Relay env.              |
| `AUTH_AI_IDENTITY_SECRET` | HMAC key for `user.id` derivation.                | Relay env (community) or HKDF-derived per app (cloud). |
| Per-record AES-256 key `K` | Encrypts the OAuth token blob (AES-256-GCM).      | The user's JWT — never persisted server-side. |

The relay cannot decrypt stored tokens from the database alone. It needs the user's JWT for that record. A DB leak yields ciphertext only.

In the cloud edition, the per-app `IDENTITY_SECRET` is HKDF-SHA256-derived from a single master secret + the app's `appId`:

```
identitySecret_app = HKDF-SHA256(MASTER_SECRET, info='authai-cloud-identity:' + appId)
```

This means two different apps that share a ChatGPT user see different `user.id` values for that same user. Cross-app identity linking by `sub` is structurally impossible.

## Session JWT shape

```json
{
  "v": 2,
  "rid": "01HX...",       // record id in auth_records
  "k":   "base64url(K)",  // per-record AES key
  "prov": "openai",       // provider id
  "app":  "app_01HX...",  // present ONLY in cloud edition
  "iat": 1234567890,
  "exp": 1234567890
}
```

Community-edition JWTs never carry the `app` claim. Cloud-edition JWTs always do. The verifier checks `jwt.app === tenant.appId` on every `/v1/*` and `/auth/whoami` request — cross-tenant replay returns the standard uniform 401 with no oracle.

## Sign-in flow

```
end-user browser              AuthAI relay                  provider (ChatGPT / Grok / GitHub)
       │                            │                                       │
       │  POST /auth/start          │                                       │
       │ ─────────────────────────► │  device code request                  │
       │                            │ ─────────────────────────────────────►│
       │                            │ ◄───────────────────────────────────  │
       │ ◄───────────────────────── │  { deviceAuthId, userCode,            │
       │  { sessionId, userCode,    │    verificationUrl, intervalMs }      │
       │    verificationUrl, … }    │                                       │
       │                            │                                       │
       │  user visits verificationUrl, enters userCode                      │
       │ ────────────────────────────────────────────────────────────────► │
       │                            │                                       │
       │  GET /auth/poll/:sessionId │                                       │
       │ ─────────────────────────► │  POLL                                 │
       │                            │ ─────────────────────────────────────►│
       │                            │ ◄───────────────────────────────────  │
       │                            │  access + refresh tokens              │
       │                            │                                       │
       │ ◄───────────────────────── │
       │  { status: "complete",     │
       │    jwt: "…" }              │
```

In the cloud edition, `/auth/start` resolves a tenant by `Origin` header (browser) or `x-authai-secret` header (backend) BEFORE the device-code call. The sessionId is bound to that tenant; subsequent polls under a different tenant return 404 (cross-tenant session theft guard).

## Per-request flow (model call)

```
end-user                  builder's backend                AuthAI relay              provider
   │                              │                            │                          │
   │  …jwt in Authorization…      │                            │                          │
   │ ────────────────────────────►│                            │                          │
   │                              │  POST /v1/chat/completions │                          │
   │                              │  Authorization: Bearer JWT │                          │
   │                              │  x-authai-secret: <sec>    │  (cloud only)            │
   │                              │ ──────────────────────────►│                          │
   │                              │                            │  1. resolve tenant       │
   │                              │                            │  2. verify JWT (HS256)   │
   │                              │                            │  3. JWT.app === tenant?  │
   │                              │                            │  4. load record by rid   │
   │                              │                            │  5. record.app === tenant?│
   │                              │                            │  6. AES-decrypt blob     │
   │                              │                            │  7. refresh if needed    │
   │                              │                            │  8. forward to provider  │
   │                              │                            │ ────────────────────────►│
   │                              │ ◄──────────────────────────│ ◄────────────────────────│
   │ ◄────────────────────────────│  streamed response         │
```

OAuth tokens never leave the relay process. The builder's backend sees only the AuthAI JWT.

## Tenant resolution (cloud edition)

`CloudTenantResolver` in `packages/cloud/src/tenant.ts` is the per-request lookup. It checks two headers in order:

1. `x-authai-secret` — used by backend-to-backend calls to `/v1/*`. This is the `AUTH_AI_SECRET` the builder wrote to `.env` via `npx authai-cloud init`. The header name + the env name are deliberately "secret" rather than "key" so the value's sensitivity is obvious at both layers (env file + wire format).
2. `Origin` — used by browser flows to `/auth/start`. Matched against the app's registered origin.

Missing or unknown → null → uniform 401 from `tenantMiddleware`.

A 30s in-memory cache fronts both lookups. Cache invalidation on app deletion is implicit (deleted apps return null from the store; the next post-TTL lookup picks up the change). Reads from the `apps` table are point reads on a unique index, so even cold-cache traffic is fine.

## Kill switch states

The cloud relay maintains a state in Redis with three values:

| State        | `/auth/start` | `/v1/*`        | `/auth/whoami`, `/auth/revoke` | When                |
| ------------ | :-----------: | :------------: | :----------------------------: | ------------------- |
| `healthy`    | ✓              | ✓              | ✓                              | Normal operation     |
| `paused-new` | 503            | ✓              | ✓                              | Daily cost cap (soft 80% / hard 100%) or planned maintenance |
| `read-only`  | 503            | 503 structured | ✓                              | Security incident, provider shutdown, manual |

Transitions to `paused-new` are automatic at the soft / hard threshold of the daily request counter. Transitions to `read-only` are operator-driven via a CLI command gated by `OPERATOR_SECRET` (deliberately not exposed via the admin API, so a leaked admin JWT cannot bypass the cap).

**Redis unreachable**: the kill switch fails OPEN and emits an alert event. Cost cap is best-effort; reliability for users matters more.

## Origin verification

When a builder registers an app via the admin API, the relay generates a random verify token. The builder publishes `TXT authai-verify=<token>` on their origin's hostname. The cloud relay re-checks DNS:

- 60s positive cache after success.
- 30 days before re-verifying a previously-verified origin.
- DNS query via `node:dns/promises#resolveTxt`. Fly.io and similar hosts respect the system resolver, which is typically a public resolver in production.

Auto-allowed origins (`localhost:*`, `127.0.0.1:*`, `*.vercel.app`) skip DNS verification entirely. They're still rate-limit-capped to an "ephemeral bucket" (default 100 req/day) until promoted by DNS verification or operator action.

## Audit log

Cloud edition writes `audit_events` rows for every state-changing operation:

```
audit_events (
  id          TEXT PRIMARY KEY,
  ts          BIGINT NOT NULL,
  actor_type  TEXT NOT NULL,           -- user | owner | operator | system | origin_change
  actor_id    TEXT NOT NULL,           -- e.g. github user id, operator label
  app_id      TEXT,                    -- null for global events
  event_type  TEXT NOT NULL,           -- 'app_created' | 'app_kill_switched' | …
  payload     JSONB NOT NULL
)
```

Append-only. No update path. Retention defaults to 13 months; the operator wires a periodic job to delete older rows.

## Schema (cloud edition)

`auth_records` is the same shape as community + optional `app_id` column. Unique index is `(COALESCE(app_id, ''), account_id_hash)` so community NULL rows and cloud per-app rows coexist cleanly.

`apps` (one row per registered app):
```
id                    PRIMARY KEY
api_key_hash          UNIQUE (SHA-256 of the AUTH_AI_SECRET shown once at creation)
origin                UNIQUE (full URL — scheme + host + optional port)
name                  (1-80 chars, shown on consent screen)
owner_github_id       (creator's GitHub numeric id)
owner_email           (best-effort from GitHub /user)
origin_verified       (bool)
origin_verified_at    (ms)
origin_verify_token   (the DNS TXT token)
rate_limit_per_min    (default 60)
daily_request_cap     (default 1000 for verified, 100 for ephemeral)
revoked_at            (nullable ms)
created_at, updated_at
```

`audit_events`: see above.

## Where the code lives

| Concern                               | Package                        | File                          |
| ------------------------------------- | ------------------------------ | ----------------------------- |
| Crypto (AES-GCM + HMAC + record key)  | `@authai/relay`                | `crypto.ts`                   |
| JWT issue + verify                    | `@authai/relay`                | `jwt.ts`                      |
| Tenant abstraction + middleware       | `@authai/relay`                | `tenant.ts`                   |
| `/auth/*` routes                      | `@authai/relay`                | `auth-routes.ts`              |
| `/v1/*` routes                        | `@authai/relay`                | `v1-routes.ts`                |
| App composition + boot validation     | `@authai/relay`                | `app.ts`                      |
| SQLite store                          | `@authai/relay-store-sqlite`   | `index.ts`                    |
| Postgres store + apps + audit         | `@authai/relay-store-postgres` | `index.ts`                    |
| Cloud tenant resolver (Origin / api key) | `@authai/cloud`             | `tenant.ts`                   |
| HKDF per-app identity derivation      | `@authai/cloud`                | `identity.ts`                 |
| Kill switch + rate limiter            | `@authai/cloud`                | `kill-switch.ts`              |
| DNS TXT origin verification           | `@authai/cloud`                | `origin-verify.ts`            |
| `npx authai-cloud init` CLI           | `authai-cloud` (unscoped npm pkg, `packages/cli` in workspace) | `bin.ts`, `init.ts` |
| Self-hosted boot                      | `apps/relay-server`            | `index.ts`                    |
| Cloud relay boot                      | `apps/cloud-relay-server`      | `index.ts`                    |
| Cloud webapp (landing/dashboard/docs/CLI bridge) | `apps/cloud-web`    | `src/app/`                    |
| Webapp GitHub OAuth (web flow)        | `apps/cloud-web`               | `src/lib/github.ts`           |
| Webapp session cookie + CLI bridge    | `apps/cloud-web`               | `src/lib/session.ts`, `cli-bridge.ts` |

## Rotation procedures

`AUTH_AI_JWT_SECRET` rotation invalidates every active session. Users sign in again; existing encrypted records stay valid and get re-linked on the next sign-in.

`AUTH_AI_IDENTITY_SECRET` (community) or `AUTH_AI_CLOUD_MASTER_SECRET` (cloud) rotation changes the `user.id` for every account on the next sign-in. If your app's database keys off `user.id`, those records orphan. Treat this as a planned identity reset with a migration plan, not an operational rotation.

In the cloud edition specifically, rotating the master secret invalidates every per-app derived `IDENTITY_SECRET` simultaneously. Every app's users get fresh `user.id` values. This is rarely the right move.

## Threat model

Verbatim from [security.md](./security.md): the relay cannot decrypt stored tokens from a DB leak alone (per-record AES keys live only in JWTs). The cloud edition inherits this property — even though one company hosts many tenants, the host cannot decrypt any tenant's user tokens from disk.

The cloud edition adds two new threat surfaces relative to community:

- **Cross-tenant JWT replay.** Mitigated by the JWT `app` claim + tenant middleware (uniform 401 on mismatch) and a defense-in-depth check against the record's `app_id` column.
- **Origin spoofing.** A builder could register `bank.com` as their origin in an attempt to confuse end users. Mitigated by DNS TXT verification (required to lift the ephemeral-bucket cap) and manual review for high-risk TLDs (`*.bank`, `*.gov`, etc.).

The host (operator) is in scope as a trusted party. They can read the runtime memory of the relay process and therefore observe any per-record key passing through. They cannot decrypt records at rest.
