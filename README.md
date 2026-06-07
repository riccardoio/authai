# AuthAI

**Sign in with ChatGPT — for app builders.**

Let your end users pay for AI features with their own ChatGPT subscription. They sign in via OAuth, your app calls models on their behalf, the cost stays on their plan. Drop in a React component, point the official `openai` SDK at the relay, done.

Self-hostable. No cloud service to sign up for. You run the relay yourself; the SDK talks to it.

> Experimental. AuthAI relies on the public Codex CLI OAuth client to authenticate with ChatGPT's backend, so model availability is whatever the Codex catalog exposes. Not affiliated with OpenAI. Use for personal projects and demos.

## How it works

```
end-user browser
    │   signs in with "Sign in with ChatGPT" → receives a JWT
    │   sends JWT to your backend however it normally sends auth
    ▼
your existing backend (api.example.com)
    │   new OpenAI({ apiKey: jwt, baseURL: relayUrl + "/v1" })
    │   uses openai.chat.completions.create(...) as you already do
    ▼
AuthAI relay (self-hosted)
    │   verifies JWT, decrypts the user's OpenAI tokens using the key in the JWT
    │   translates Chat Completions → Codex Responses, calls chatgpt.com/backend-api
    │   refreshes tokens server-side if needed, re-encrypts in place
    ▼
ChatGPT subscription (user pays)
```

## Security model

The relay encrypts each user's OAuth tokens with a fresh per-record AES-256 key. The key is **never persisted server-side** — it's embedded in the JWT issued to the client. Both the encrypted blob (on disk) and the key (in the JWT) are required to use the credential.

| Threat                                            | Outcome                                              |
| ------------------------------------------------- | ---------------------------------------------------- |
| Full database leak                                | Blobs unreadable — no keys on disk                   |
| Full filesystem leak including the JWT secret     | Still no per-record keys — existing blobs stay safe  |
| One user's JWT stolen via XSS on the app          | Revoke via `POST /auth/revoke`                       |
| Server runtime RAM compromise                     | Lost — true for any system                           |
| Your backend gets pwned                           | Lost — JWTs flow through it. Your responsibility     |

## Quickstart — run the relay

```bash
git clone <repo> && cd authai
pnpm install

cat > apps/relay-server/.env <<EOF
AUTH_AI_JWT_SECRET=$(openssl rand -hex 32)
AUTH_AI_ORIGINATOR=my-app
AUTH_AI_DB_URL=./relay.db
EOF

pnpm dev:relay
# AuthAI relay listening on http://localhost:3000
```

`AUTH_AI_ORIGINATOR` is the name shown on the ChatGPT consent screen during sign-in.

## Integrate

### Frontend (React)

```tsx
import { AuthAIProvider, SignInWithChatGPT, useAuthAI } from "@authai/react";

function App() {
  return (
    <AuthAIProvider relayUrl="https://your-relay.com" storage="localStorage">
      <YourApp />
    </AuthAIProvider>
  );
}

function YourApp() {
  const { jwt, isSignedIn, signOut } = useAuthAI();
  if (!isSignedIn) return <SignInWithChatGPT />;

  // send `jwt` to your backend however you normally send auth
  // (Bearer header, cookie, request body, etc.)
}
```

The SDK only exposes the JWT. There's no `client.chat()` method, no wrapper around `openai` — model calls happen in your backend, using the package you already use.

### Backend

```ts
import OpenAI from "openai";

// jwt comes from your incoming request (header, cookie, etc.)
const openai = new OpenAI({
  apiKey: jwt,
  baseURL: process.env.AUTH_AI_RELAY_URL + "/v1",
});

const stream = await openai.chat.completions.create({
  model: "gpt-5.4",
  messages: [{ role: "user", content: "hi" }],
  stream: true,
});
for await (const chunk of stream) {
  process.stdout.write(chunk.choices[0]?.delta?.content ?? "");
}
```

Any existing `openai`-based code keeps working as-is. You swap two constructor fields.

## Supported endpoints

The Codex backend only accepts a subset of OpenAI's API:

| Endpoint                       | Status                                                |
| ------------------------------ | ----------------------------------------------------- |
| `POST /v1/chat/completions`    | Supported (translated to Codex Responses internally)  |
| `POST /v1/responses`           | Supported (pass-through)                              |
| `GET /v1/models`               | Returns the Codex model catalog                       |
| Embeddings, vision, audio, batch, assistants, fine-tunes | Not supported — return a structured `unsupported_endpoint` error |

## Supported models

| Model           | Use                                       |
| --------------- | ----------------------------------------- |
| `gpt-5.4`       | Default. Good balance of speed and quality |
| `gpt-5.4-mini`  | Cheaper / faster                          |
| `gpt-5.4-pro`   | Higher quality                            |
| `gpt-5.4-codex` | Coding-tuned                              |
| `gpt-5.5`       | Newest                                    |
| `gpt-5.5-pro`   | Newest, top tier                          |

Sending an unsupported model name (e.g. `gpt-4`) returns a 400 from the Codex backend.

## Configuration

| Variable                | Default            | Notes                                                                       |
| ----------------------- | ------------------ | --------------------------------------------------------------------------- |
| `AUTH_AI_JWT_SECRET`    | required           | 32+ bytes hex (use `openssl rand -hex 32`)                                  |
| `AUTH_AI_ORIGINATOR`    | required           | Shown on the ChatGPT consent screen                                         |
| `AUTH_AI_DB_DRIVER`     | `sqlite`           | Only `sqlite` is implemented in v2; postgres is planned                     |
| `AUTH_AI_DB_URL`        | `./relay.db`       | SQLite file path, or `postgres://...` (driver pending)                      |
| `AUTH_AI_PORT`          | `3000`             |                                                                             |

## Use AuthAI Cloud instead (skip the setup)

If you don't want to run the relay yourself, the same code is hosted as a free service. One command from a fresh project:

```bash
npx authai-cloud init
# → opens cloud.authai.dev in your browser to sign in with GitHub,
#   create an app, and writes AUTH_AI_SECRET=... to .env
```

Then in your backend:

```ts
import OpenAI from "openai";

const openai = new OpenAI({
  apiKey: jwt,
  baseURL: "https://relay.authai.dev/v1",
  defaultHeaders: { "x-authai-secret": process.env.AUTH_AI_SECRET! },
});
```

`AUTH_AI_SECRET` is a per-app credential — keep it server-side, never ship it to the browser, never commit it. Lose it and the only recovery is to revoke the app and create a new one (the relay stores only a hash).

Two domains:

- **`cloud.authai.dev`** — Next.js webapp. Landing page, GitHub sign-in, dashboard, docs viewer, CLI bridge. You manage apps here.
- **`relay.authai.dev`** — Hono relay. Pure data plane. The endpoint your end users sign in against and your backend hits for model calls.

Same encryption model as self-hosting. The cloud host runs the same code from this repo and stores only ciphertext — per-record AES keys still live exclusively in the user's JWT and never reach the relay's servers in a decryptable form. See [docs/reference.md](./docs/reference.md) for the full architecture.

AuthAI Cloud is experimental and rate-limited. Treat it as a free demo service.

## Repo layout

```
packages/
├── relay                core: OAuth flow, JWT, AES-GCM, OpenAI-compat proxy
├── relay-store-sqlite   default SQLite storage driver
├── relay-store-postgres Postgres driver (cloud edition uses this)
├── cloud                cloud edition: tenant, admin API, kill switch, rate limits
├── cli                  npx authai-cloud — one-command app registration
└── react                <AuthAIProvider>, <SignInWithChatGPT>, useAuthAI()
apps/
├── relay-server         executable that boots the community (self-hosted) relay
├── cloud-relay-server   executable that boots the cloud edition's relay (Fly.io)
├── cloud-web            Next.js webapp for AuthAI Cloud (Vercel) — landing, sign-in, dashboard, docs viewer, CLI bridge
├── example-backend      tiny Node demo using the openai SDK against the relay
└── example-react        Vite + React frontend demo
```

## Run the demo end-to-end

```bash
pnpm dev:relay      # → :3000
pnpm dev:backend    # → :4000  (uses the openai npm package against the relay)
pnpm dev:example    # → :5173  (Vite + React)
```

Open http://localhost:5173, click **Sign in with ChatGPT**, authorize at `auth.openai.com/codex/device`, send a message.

## Tests

```bash
pnpm test
```

29 unit tests cover the encryption primitives, JWT issue/verify, and the Chat Completions ↔ Codex Responses translation layer. Higher-level wiring (auth routes, SQLite store CRUD, refresh flow) is exercised by the demo but not yet covered by automated tests.

## Roadmap

- Postgres storage driver
- Framework-agnostic `@authai/web` SDK (vanilla / web component)
- Express / Next.js middleware helpers
- Cloud edition (multi-tenant, dashboard, branded consent originators)
