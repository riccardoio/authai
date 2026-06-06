# Integration

Wire AuthAI into a frontend + backend app in about 20 lines. For self-hosting the relay, see [installation.md](./installation.md).

## What you're integrating

- **`@authai/react`** — Provider + sign-in component + hook. Returns a session JWT to your app.
- **`@authai/server`** — Backend SDK. Verifies the JWT with the relay, returns user identity and a pre-configured OpenAI client.

The JWT flows: **end-user browser → your backend → AuthAI relay → AI provider**. Your backend never sees OAuth tokens; the relay decrypts them internally on each call.

## Install

```bash
pnpm add @authai/react @authai/server
```

`openai` is an optional peer dependency of `@authai/server`. Install it to get a pre-configured client:

```bash
pnpm add openai
```

> **Status:** The packages are in this monorepo but not yet published to npm. To use them in an external project today, link from a local clone or vendor them in.

## Frontend

Wrap your app with `<AuthAIProvider>` once and drop in a `<SignIn>` button anywhere.

```tsx
import { AuthAIProvider, SignIn, useAuthAI } from "@authai/react";

function App() {
  return (
    <AuthAIProvider
      relayUrl="https://relay.authai.dev"
      appName="My App"
    >
      <Chat />
    </AuthAIProvider>
  );
}

function Chat() {
  const { jwt, isSignedIn } = useAuthAI();
  if (!isSignedIn) return <SignIn />;
  // jwt is the user's session — send it to your backend on each AI request.
}
```

### Provider picker vs preset

```tsx
// Picker — user chooses between ChatGPT, Grok, Copilot.
<SignIn>Sign in</SignIn>

// Preset — skips the picker, goes directly to that provider's flow.
<SignIn provider="openai">Sign in with ChatGPT</SignIn>
<SignIn provider="xai">Sign in with Grok</SignIn>
<SignIn provider="github">Sign in with Copilot</SignIn>
```

### `useAuthAI()` return shape

```ts
{
  jwt: string | null,           // null until signed in
  provider: ProviderId | null,  // "openai" | "xai" | "github" | null
  isSignedIn: boolean,
  error: string | null,
  signIn(provider?: ProviderId): void,
  signOut(): void,
}
```

`jwt` is the only thing you actually need to ship to your backend.

### Theming

```tsx
<AuthAIProvider
  relayUrl="..."
  appName="..."
  theme={{
    mode: "system",      // "light" | "dark" | "system"
    radius: "12px",
    fontFamily: '"Inter", system-ui, sans-serif',
    colors: {
      overlay: "rgba(0,0,0,0.5)",
      surface: "#ffffff",
      surfaceMuted: "#f5f5f5",
      border: "#e5e5e5",
      foreground: "#0a0a0a",
      foregroundMuted: "#737373",
      primary: "#0a0a0a",
      primaryForeground: "#ffffff",
      primaryHover: "#262626",
      accent: "#1d4dff",
      danger: "#b91c1c",
    },
  }}
>
```

All theme fields are optional. Omit to inherit defaults.

### Storage

The JWT lives client-side. By default it's in `localStorage`; change with the `storage` prop.

```tsx
<AuthAIProvider storage="localStorage">  // default
<AuthAIProvider storage="memory">        // session-only
<AuthAIProvider storage={myAdapter}>     // implement TokenStorage
```

## Backend

### Sending the JWT from your frontend

Whatever auth pattern your app already uses works — `Authorization` header, cookie, request body. Header example:

```ts
const { jwt } = useAuthAI();
await fetch("/api/chat", {
  method: "POST",
  headers: { "Authorization": `Bearer ${jwt}` },
  body: JSON.stringify({ model, messages }),
});
```

### Receiving and verifying

```ts
import { authai, AuthAIUnauthorized } from "@authai/server";

export async function POST(req) {
  const jwt = req.headers.get("authorization")?.slice("Bearer ".length);

  try {
    const { user, apiKey, baseURL, openai } = await authai.session({
      jwt,
      relayUrl: "https://relay.authai.dev",
    });

    // user.id        — opaque, stable across re-sign-ins, namespaced per provider
    // user.provider  — "openai" | "xai" | "github"
    // openai         — pre-configured client; bill lands on the user's plan
    // apiKey/baseURL — wire LangChain, AI SDK, or any custom client instead

    const stream = await openai.chat.completions.create({
      model: "gpt-5.4",
      messages,
      stream: true,
    });
    return new Response(stream.toReadableStream());
  } catch (err) {
    if (err instanceof AuthAIUnauthorized) {
      return new Response("Unauthorized", { status: 401 });
    }
    throw err;
  }
}
```

### `authai.session()` return shape

```ts
{
  user: { id: string, provider: "openai" | "xai" | "github" },
  session: { expires: number | null },   // unix seconds
  apiKey: string,                         // the jwt itself
  baseURL: string,                        // <relayUrl>/v1
  openai?: OpenAI,                        // only if `openai` peer is installed
}
```

### `authai.session()` options

```ts
authai.session({
  jwt,                       // required
  relayUrl,                  // required
  cache: true,               // default; in-process identity cache (60s TTL)
  cacheTtlMs: 60_000,        // override TTL (capped by JWT exp)
  fetch: customFetch,        // override the fetch impl (for tests / proxies)
});

// Disable caching entirely:
authai.session({ jwt, relayUrl, cache: false });

// Inject a shared cache (e.g. Redis):
authai.session({ jwt, relayUrl, cache: redisAdapter });
```

> **Cache safety:** Cached identity is non-authoritative. Every `/v1/*` call still goes through the relay, so revocation is enforced even when whoami is cached.

## Using with other AI SDKs

The `openai` client is a convenience. The `apiKey` + `baseURL` work with any OpenAI-compatible client.

```ts
const { apiKey, baseURL } = await authai.session({ jwt, relayUrl });

// LangChain
import { ChatOpenAI } from "@langchain/openai";
const llm = new ChatOpenAI({
  openAIApiKey: apiKey,
  configuration: { baseURL },
});

// Vercel AI SDK
import { createOpenAI } from "@ai-sdk/openai";
const provider = createOpenAI({ apiKey, baseURL });

// Custom fetch
await fetch(`${baseURL}/chat/completions`, {
  headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
  method: "POST",
  body: JSON.stringify({ model, messages }),
});
```

## Supported providers

| Provider          | Sign-in mechanism                 | Model list source                     |
| ----------------- | --------------------------------- | ------------------------------------- |
| **ChatGPT**       | OAuth device code via Codex CLI   | Documented Codex catalog              |
| **Grok (xAI)**    | OAuth device code via Grok CLI    | Live `api.x.ai/v1/models`             |
| **GitHub Copilot**| GitHub device code → Copilot token| Live `api.individual.githubcopilot.com/models` |

## Supported endpoints

The relay speaks OpenAI's wire format. Whichever provider the signed-in user has, the call lands on their plan.

| Endpoint                       | Status                                                                  |
| ------------------------------ | ----------------------------------------------------------------------- |
| `POST /v1/chat/completions`    | Supported. Chat Completions ↔ Codex Responses translated for ChatGPT.   |
| `POST /v1/responses`           | Supported. Pass-through to Codex Responses.                             |
| `GET /v1/models`               | Returns the live model catalog scoped to the signed-in provider.        |
| Embeddings, vision, audio, batch, assistants, fine-tunes | Not available via Codex auth — return a `unsupported_endpoint` error. |

## Error handling

`authai.session()` throws `AuthAIUnauthorized` (extends `Error`, `status: 401`) on any auth failure. Surface it as a 401 to the caller:

```ts
try {
  await authai.session({ jwt, relayUrl });
} catch (err) {
  if (err instanceof AuthAIUnauthorized) {
    // missing, expired, revoked, malformed JWT — all uniform
    return new Response("Unauthorized", { status: 401 });
  }
  throw err; // network / unexpected
}
```

Model call errors come from the provider directly through the `openai` SDK (e.g. `model not supported`, `rate limit`). Handle them the same way you would any OpenAI SDK call.

## End-to-end checklist

1. Relay is up at `https://relay.authai.dev/` returning `{ok: true}`.
2. Frontend wraps `<App>` in `<AuthAIProvider>` with that `relayUrl`.
3. `<SignIn>` button renders the dialog and you reach the provider's device-code page.
4. After authorizing, `useAuthAI().jwt` is a non-null string.
5. Frontend sends `jwt` to your backend on every AI request.
6. Backend calls `authai.session({ jwt, relayUrl })`, gets `{ user, openai }`.
7. `openai.chat.completions.create({...})` streams text back.
8. `user.id` is the same on re-sign-in for the same account.
