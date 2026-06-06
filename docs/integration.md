# Integration

Add AuthAI to a frontend + backend app: render the sign-in UI, send the session JWT to your backend, and create an OpenAI-compatible client from that JWT. For self-hosting the relay, see [installation.md](./installation.md).

## What you're integrating

- **`@authai/react`** — Provider + sign-in component + hook. Returns a session JWT to your app.
- **`@authai/server`** — Backend SDK. Verifies the JWT with the relay, returns user identity and a pre-configured OpenAI client.

The JWT flows: **end-user browser → your backend → AuthAI relay → AI provider**. Your backend never sees OAuth tokens; the relay decrypts them internally on each call.

## Install

> **Status.** `@authai/react` and `@authai/server` are not yet published to npm. The patterns below are how they're meant to be used; until publication, depend on them via pnpm workspaces or by linking from a local clone of the monorepo.

When published:

```bash
pnpm add @authai/react @authai/server
```

`openai` is an optional peer dependency of `@authai/server`. Install it on the backend if you want the pre-configured client:

```bash
pnpm add openai
```

Without it, you still get `{ user, apiKey, baseURL }` and can construct any OpenAI-compatible client yourself.

## Frontend

Wrap your app with `<AuthAIProvider>` once and drop in a `<SignIn>` button anywhere.

```tsx
import { AuthAIProvider, SignIn, useAuthAI } from "@authai/react";

function App() {
  return (
    <AuthAIProvider
      relayUrl="https://your-relay.example"
      appName="My App"
    >
      <Chat />
    </AuthAIProvider>
  );
}

function Chat() {
  const { jwt, isSignedIn } = useAuthAI();
  if (!isSignedIn) return <SignIn />;

  async function ask(messages) {
    const res = await fetch("/api/chat", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${jwt}`,
      },
      body: JSON.stringify({ messages }),
    });
    // res.body is a stream; render the chunks.
  }
}
```

> **The JWT is a bearer credential carrying decryption material.** Anyone who reads it can drive the user's AuthAI session until it expires or is revoked. In the default `localStorage` configuration, an XSS on your page exposes the JWT. Treat the AuthAI JWT the same way you'd treat any session token: ship a strict CSP, sanitize all user-controlled HTML, and consider `storage="memory"` if you'd rather lose sessions on reload than keep one around for XSS to steal.

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
<AuthAIProvider storage="memory">        // session-only, lost on reload
<AuthAIProvider storage={myAdapter}>     // see TokenStorage interface
```

The `TokenStorage` interface:

```ts
type TokenStorage = {
  get(): string | null;
  set(token: string): void;
  clear(): void;
};
```

## Backend

### Sending the JWT from your frontend

Prefer an `Authorization: Bearer <jwt>` header — that's what the snippets in this guide assume. Cookies also work if your app already handles CSRF and same-site settings. Avoid putting the JWT in a request body unless you have a specific reason: bodies tend to be more loggable and harder to redact than headers.

```ts
const { jwt } = useAuthAI();
await fetch("/api/chat", {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    Authorization: `Bearer ${jwt}`,
  },
  body: JSON.stringify({ messages }),
});
```

### Receiving and verifying

```ts
import { authai, AuthAIUnauthorized } from "@authai/server";

export async function POST(req) {
  const jwt = req.headers.get("authorization")?.slice("Bearer ".length);
  const { messages } = await req.json();

  try {
    const { user, apiKey, baseURL, openai } = await authai.session({
      jwt,
      relayUrl: "https://your-relay.example",
    });

    // user.id        — opaque, stable across re-sign-ins, namespaced per provider
    // user.provider  — "openai" | "xai" | "github"
    // openai         — pre-configured client (requires the openai peer dep)
    // apiKey/baseURL — wire LangChain, AI SDK, or any custom client instead

    if (!openai) {
      throw new Error("Install the `openai` package to use the pre-configured client.");
    }

    const stream = await openai.chat.completions.create({
      model: "gpt-5.4", // pick from GET /v1/models on the relay (see below)
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

Available models depend on which provider the user signed in with. Always source them from the relay's `/v1/models` endpoint rather than hard-coding:

```ts
const models = await openai.models.list();
const defaultModel = models.data[0]?.id;
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

> **Cache safety.** Cached identity is non-authoritative. Every `/v1/*` call still goes through the relay, so revocation is enforced even when whoami is cached.

## End-to-end example (Next.js App Router)

A minimal working integration in a Next.js 15 app.

**`app/layout.tsx`** — provider at the root:

```tsx
import { AuthAIProvider } from "@authai/react";

export default function RootLayout({ children }) {
  return (
    <html>
      <body>
        <AuthAIProvider
          relayUrl={process.env.NEXT_PUBLIC_AUTHAI_RELAY_URL!}
          appName="My App"
        >
          {children}
        </AuthAIProvider>
      </body>
    </html>
  );
}
```

**`app/page.tsx`** — sign-in + chat:

```tsx
"use client";
import { SignIn, useAuthAI } from "@authai/react";
import { useState } from "react";

export default function Page() {
  const { jwt, isSignedIn } = useAuthAI();
  const [reply, setReply] = useState("");
  const [pending, setPending] = useState(false);

  if (!isSignedIn) return <SignIn>Sign in</SignIn>;

  async function ask(prompt) {
    setReply(""); setPending(true);
    const res = await fetch("/api/chat", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${jwt}`,
      },
      body: JSON.stringify({
        messages: [{ role: "user", content: prompt }],
      }),
    });
    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      setReply((r) => r + decoder.decode(value));
    }
    setPending(false);
  }

  return (
    <form onSubmit={(e) => { e.preventDefault(); ask(new FormData(e.currentTarget).get("p") as string); }}>
      <input name="p" disabled={pending} />
      <pre>{reply}</pre>
    </form>
  );
}
```

**`app/api/chat/route.ts`** — the AI endpoint:

```ts
import { authai, AuthAIUnauthorized } from "@authai/server";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const jwt = req.headers.get("authorization")?.slice("Bearer ".length);
  const { messages } = await req.json();

  try {
    const { user, openai } = await authai.session({
      jwt,
      relayUrl: process.env.AUTHAI_RELAY_URL!,
    });
    if (!openai) return new Response("Install `openai`", { status: 500 });

    console.log(`[chat] user=${user.id.slice(0, 8)}… provider=${user.provider}`);

    const stream = await openai.chat.completions.create({
      model: "gpt-5.4",
      messages,
      stream: true,
    });

    const encoder = new TextEncoder();
    const body = new ReadableStream({
      async start(controller) {
        for await (const chunk of stream) {
          const delta = chunk.choices[0]?.delta?.content;
          if (delta) controller.enqueue(encoder.encode(delta));
        }
        controller.close();
      },
    });
    return new Response(body, { headers: { "Content-Type": "text/plain" } });
  } catch (err) {
    if (err instanceof AuthAIUnauthorized) return new Response("Unauthorized", { status: 401 });
    throw err;
  }
}
```

Set `NEXT_PUBLIC_AUTHAI_RELAY_URL` (client-visible) and `AUTHAI_RELAY_URL` (server-only) to your relay's public URL, then `next dev`.

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

| Provider          | Sign-in mechanism                 | Model list source                              |
| ----------------- | --------------------------------- | ---------------------------------------------- |
| **ChatGPT**       | OAuth device code via Codex CLI   | Documented Codex catalog                       |
| **Grok (xAI)**    | OAuth device code via Grok CLI    | Live `api.x.ai/v1/models`                      |
| **GitHub Copilot**| GitHub device code → Copilot token| Live `api.individual.githubcopilot.com/models` |

## Not supported

AuthAI's surface is text chat: `chat.completions`, `responses`, and `models`. Embeddings, vision, audio, batch, assistants, and fine-tunes are **not currently supported** — calls return a structured `unsupported_endpoint` error. The underlying provider OAuth flows either don't expose those surfaces to third-party tools or expose them inconsistently across providers; adding any one of them requires per-provider work.

| Endpoint                       | Status                                                                  |
| ------------------------------ | ----------------------------------------------------------------------- |
| `POST /v1/chat/completions`    | Supported. Chat Completions ↔ Codex Responses translated for ChatGPT.   |
| `POST /v1/responses`           | Supported. Pass-through to Codex Responses.                             |
| `GET /v1/models`               | Returns the live model catalog scoped to the signed-in provider.        |

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

1. Relay is up at `https://your-relay.example/` and returns `{"ok": true, "service": "authai-relay"}`.
2. Frontend wraps `<App>` in `<AuthAIProvider>` with that `relayUrl`.
3. `<SignIn>` renders the dialog and reaches the provider's device-code page.
4. After authorizing, `useAuthAI().jwt` is a non-null string.
5. Frontend sends `jwt` to your backend on every AI request via `Authorization: Bearer …`.
6. Backend calls `authai.session({ jwt, relayUrl })` and gets `{ user, openai }`.
7. `openai.chat.completions.create({...})` streams text back.
8. `user.id` is the same on re-sign-in for the same account.
