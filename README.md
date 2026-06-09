# AuthAI

[![npm version](https://img.shields.io/npm/v/%40authai-io%2Freact?label=%40authai-io%2Freact)](https://www.npmjs.com/package/@authai-io/react)
[![npm version](https://img.shields.io/npm/v/authai-cloud?label=authai-cloud)](https://www.npmjs.com/package/authai-cloud)
[![license](https://img.shields.io/npm/l/%40authai-io%2Freact)](./LICENSE)
[![GitHub stars](https://img.shields.io/github/stars/authai-io/authai?style=flat&logo=github)](https://github.com/authai-io/authai/stargazers)

**Sign in with ChatGPT, Grok, or Copilot — for app builders.**

> [!NOTE]
> **Enjoying AuthAI?** Something more ambitious is in the works — [get in touch](mailto:riccardo@interfacelabs.ai?subject=Saw%20AuthAI%20-%20what%20next%3F).

Let your end users pay for AI features with their existing ChatGPT, Grok, or GitHub Copilot subscription. They sign in via OAuth, your app calls models on their behalf, the cost stays on their plan. Drop in a React component, point the official `openai` SDK at the relay, done.

Two ways to use it: the hosted service at [authai.io](https://authai.io) (free, no setup) or self-host the relay yourself.

> Experimental. AuthAI uses each provider's public device-code OAuth flow — the same one their official CLIs use. These surfaces are unofficial and providers can change them. Not affiliated with OpenAI, GitHub, or xAI. Use for personal projects and demos.

## Quickstart — AuthAI Cloud

The fastest path. Run this in a fresh project:

```bash
npx authai-cloud init
# → opens authai.io in your browser to sign in with GitHub,
#   create an app, and writes AUTH_AI_SECRET=... to .env
```

Then in your backend:

```ts
import OpenAI from "openai";

const openai = new OpenAI({
  apiKey: jwt,                              // from @authai-io/react on the frontend
  baseURL: "https://relay.authai.io/v1",
  defaultHeaders: { "x-authai-secret": process.env.AUTH_AI_SECRET! },
});
```

`AUTH_AI_SECRET` is a per-app credential — keep it server-side, never ship it to the browser, never commit it. The relay stores only a hash; if you lose it, revoke the app and create a new one.

AuthAI Cloud is free, rate-limited, and runs the same code as the self-hosted relay. It stores only ciphertext — per-record AES keys live exclusively in each user's JWT and never reach the relay's servers in a decryptable form. Want to run it yourself? See [Self-host the relay](#self-host-the-relay) below.

## How it works

Shown for ChatGPT. Grok and Copilot follow the same pattern — each uses its own provider-specific device-code OAuth flow.

```
end-user browser
    │   signs in with "Sign in with ChatGPT" → receives a JWT
    │   sends JWT to your backend however it normally sends auth
    ▼
your existing backend (api.example.com)
    │   new OpenAI({ apiKey: jwt, baseURL: relayUrl + "/v1" })
    │   uses openai.chat.completions.create(...) as you already do
    ▼
AuthAI relay (relay.authai.io or your own host)
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

## Self-host the relay

If you'd rather run the data plane yourself instead of using AuthAI Cloud:

```bash
git clone https://github.com/authai-io/authai.git && cd authai
pnpm install

cat > apps/relay-server/.env <<EOF
AUTH_AI_JWT_SECRET=$(openssl rand -hex 32)
AUTH_AI_ORIGINATOR=my-app
AUTH_AI_DB_URL=./relay.db
EOF

pnpm dev:relay
# AuthAI relay listening on http://localhost:3000
```

`AUTH_AI_ORIGINATOR` is the name shown on the ChatGPT consent screen during sign-in. Point your frontend SDK at `http://localhost:3000` instead of `https://relay.authai.io`. Everything else in the [Integrate](#integrate) section works identically.

## Integrate

### Frontend (React)

Two integration paths. The singleton path is the recommended default for client SPAs; the provider path is for SSR (Next.js, Remix) and multi-tenant.

#### Singleton (client SPAs) — recommended

```tsx
import { configureAuthAI, SignIn, useAuthAI } from "@authai-io/react";

// Call once, at module scope. No provider tree.
configureAuthAI({
  relayUrl: "https://your-relay.com",
  appName: "My App",
});

function App() {
  const { jwt, isSignedIn, signOut } = useAuthAI();
  if (!isSignedIn) return <SignIn>Sign in with AI</SignIn>;
  // send `jwt` to your backend however you normally send auth
}
```

`useAuthAI()` and `<SignIn>` work anywhere in the tree — no wrapper required. The sign-in dialog auto-mounts via portal on first use.

#### Provider (SSR + advanced)

```tsx
// app/layout.tsx — Next.js App Router
import { cookies } from "next/headers";
import { AuthAIProvider } from "@authai-io/react";

export default async function Layout({ children }) {
  const jwt = (await cookies()).get("authai-jwt")?.value ?? null;
  return (
    <AuthAIProvider
      relayUrl={process.env.NEXT_PUBLIC_AUTHAI_RELAY!}
      appName="My App"
      initialJwt={jwt}
      storage="cookie"
    >
      {children}
    </AuthAIProvider>
  );
}
```

`initialJwt` is the SSR hand-off: pass a JWT from anywhere (cookie, NextAuth session, custom header) and the first render is correctly signed-in. `storage="cookie"` mirrors the JWT to a cookie so server components can read it. Full demo in `apps/demo-nextjs`.

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
| `AUTH_AI_DB_DRIVER`     | `sqlite`           | `sqlite` (default) or `postgres`                                            |
| `AUTH_AI_DB_URL`        | `./relay.db`       | SQLite file path, or `postgres://...` for the Postgres driver               |
| `AUTH_AI_PORT`          | `3000`             |                                                                             |

## AuthAI Cloud architecture

The hosted service runs on two domains:

- **`authai.io`** — Next.js webapp. Landing page, GitHub sign-in, dashboard, docs viewer, CLI bridge. You manage apps here.
- **`relay.authai.io`** — Hono relay. Pure data plane. The endpoint your end users sign in against and your backend hits for model calls.

Both run the same code as the self-hosted relay. See [docs/reference.md](./docs/reference.md) for the full architecture.

## Repo layout

```
packages/
├── relay                core: OAuth flow, JWT, AES-GCM, OpenAI-compat proxy
├── relay-store-sqlite   default SQLite storage driver
├── relay-store-postgres Postgres driver (cloud edition uses this)
├── cloud                cloud edition: tenant, admin API, kill switch, rate limits
├── cli                  npx authai-cloud — one-command app registration
├── react                configureAuthAI(), <AuthAIProvider>, <SignIn>, useAuthAI(), cookieAdapter
└── server               authai.session(), decodeAuthAIToken() — backend helpers
apps/
├── relay-server         executable that boots the community (self-hosted) relay
├── cloud-relay-server   executable that boots the cloud edition's relay (Hetzner+Dokku)
├── cloud-web            Next.js webapp for AuthAI Cloud (Hetzner+Dokku) — landing, sign-in, dashboard, docs viewer, CLI bridge
├── demo-backend      tiny Node demo using the openai SDK against the relay
├── demo-react        Vite + React SPA demo (singleton path)
└── demo-nextjs       Next.js App Router demo (provider + SSR path)
```

## Run the demo end-to-end

```bash
pnpm dev:relay      # → :3000
pnpm dev:demo:backend    # → :4000  (uses the openai npm package against the relay)
pnpm dev:demo    # → :5173  (Vite + React)
```

Open http://localhost:5173, click **Sign in with ChatGPT**, authorize at `auth.openai.com/codex/device`, send a message.

## Tests

```bash
pnpm test
```

29 unit tests cover the encryption primitives, JWT issue/verify, and the Chat Completions ↔ Codex Responses translation layer. Higher-level wiring (auth routes, SQLite store CRUD, refresh flow) is exercised by the demo but not yet covered by automated tests.

## Roadmap

- Framework-agnostic `@authai-io/web` SDK (vanilla / web component)
- HttpOnly cookie mode (relay-side session endpoint)
- Additional provider adapters

Already shipped: Postgres storage driver (`@authai-io/relay-store-postgres`), AuthAI Cloud (`https://authai.io` + `https://relay.authai.io`) with multi-tenant dashboard and branded consent originators.
