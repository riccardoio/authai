# Integration

Add AuthAI to a frontend + backend app: render the sign-in UI, send the session JWT to your backend, and create an OpenAI-compatible client from that JWT. For self-hosting the relay, see [installation.md](./installation.md).

> **Using Lovable?** Skip this page — [docs/lovable.md](./lovable.md) is a focused walkthrough for both Supabase-backed and Supabase-less Lovable projects, including how to provision an app and which snippet to paste.

## What you're integrating

- **`@authai-io/react`** — Provider + sign-in component + hook. Returns a session JWT to your app.
- **`@authai-io/server`** — Backend SDK. Verifies the JWT with the relay, returns user identity and a pre-configured OpenAI client.

The JWT flows: **end-user browser → your backend → AuthAI relay → AI provider**. Your backend never sees OAuth tokens; the relay decrypts them internally on each call.

## Install

```bash
pnpm add @authai-io/react @authai-io/server
```

`openai` is an optional peer dependency of `@authai-io/server`. Install it on the backend if you want the pre-configured client:

```bash
pnpm add openai
```

Without it, you still get `{ user, apiKey, baseURL }` and can construct any OpenAI-compatible client yourself.

## Frontend

Two integration paths share the same SDK:

| Path | When to use | What you write |
| --- | --- | --- |
| **Singleton** (default) | Client SPAs, Electron, mobile webviews, anything single-process | `configureAuthAI()` once + bare `useAuthAI()` anywhere |
| **Provider** (advanced) | Next.js, Remix, multi-tenant, test isolation, SSR | `<AuthAIProvider initialJwt={...}>` |

`useAuthAI()` reads the provider's context if one is mounted, otherwise falls back to the singleton. Both paths use the same hook and the same `<SignIn>` button.

### Singleton

Call `configureAuthAI()` once at module scope. The sign-in dialog auto-mounts via a body portal on first use.

```tsx
import { configureAuthAI, SignIn, useAuthAI } from "@authai-io/react";

configureAuthAI({
  relayUrl: "https://your-relay.example",
  appName: "My App",
});

function App() {
  const { jwt, isSignedIn, signOut } = useAuthAI();
  if (!isSignedIn) return <SignIn>Sign in</SignIn>;

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

> **The JWT is more than a session token.** It carries a 32-byte AES key (the user-side half of the relay's split-key model). Anyone who reads it can drive the user's AuthAI session — and decrypt the user's stored OAuth credentials at the relay — until it expires or is revoked. The default `localStorage` storage has the same XSS posture as any browser session token: ship a strict CSP and sanitize all user-controlled HTML. Treat `storage="cookie"` the same way (it is not HttpOnly in v1). For higher security, use `storage="memory"` and accept that sessions die on reload.

### Provider (for SSR)

When you need server-side rendering (Next.js, Remix), use `<AuthAIProvider>` so the first paint reflects the user's auth state. The JWT comes from wherever your session lives — cookie, NextAuth, Iron Session, custom header — and you pass it via `initialJwt`.

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

`storage="cookie"` is one convenient way to get a JWT visible to your server code. You can use any other source (existing session middleware, request header forwarded from middleware, etc.) — just pass it to `initialJwt`. Passing `initialJwt={null}` explicitly suppresses the storage hydration and renders signed-out, which is what you want when the server has determined the user is not authenticated.

For server components that need to know "is the user signed in" without a relay call, use `decodeAuthAIToken` from `@authai-io/server`:

```tsx
import { cookies } from "next/headers";
import { decodeAuthAIToken } from "@authai-io/server";

export default async function Page() {
  const jwt = (await cookies()).get("authai-jwt")?.value;
  const claims = decodeAuthAIToken(jwt); // { provider, expiresAt, appId } | null
  if (!claims) redirect("/sign-in");
  // ...
}
```

Local decode never hits the relay. **Caveat:** revoked tokens still pass local decode until their JWT expiry. Every `/v1/*` call still enforces revocation server-side, so the worst case is a brief window where a revoked token can read static UI.

### Provider picker vs preset

```tsx
// No preset: user chooses between ChatGPT, Grok, Copilot.
<SignIn>Sign in</SignIn>

// Preset: provider-specific consent, then that provider's flow.
<SignIn provider="openai">Sign in with ChatGPT</SignIn>
<SignIn provider="xai">Sign in with Grok</SignIn>
<SignIn provider="github">Sign in with Copilot</SignIn>
```

### `useAuthAI()` return shape

```ts
{
  relayUrl: string | null,      // null when neither configureAuthAI nor a provider has set it
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

Pass `theme` to either `configureAuthAI()` or `<AuthAIProvider>`:

```tsx
configureAuthAI({
  relayUrl: "...",
  appName: "...",
  theme: {
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
  },
});
```

All theme fields are optional. Omit to inherit defaults.

### Storage

The JWT lives client-side. Pick the adapter that matches your environment:

```tsx
configureAuthAI({ ..., storage: "localStorage" });  // default — client SPAs
configureAuthAI({ ..., storage: "cookie" });        // SSR convenience — readable from server
configureAuthAI({ ..., storage: "memory" });        // session-only, lost on reload
configureAuthAI({ ..., storage: myAdapter });       // see TokenStorage interface
```

The `TokenStorage` interface (for Electron secure storage, React Native AsyncStorage, Capacitor Preferences, etc.):

```ts
type TokenStorage = {
  get(): string | null;
  set(token: string): void;
  clear(): void;
};
```

Cookie storage options (override defaults if needed):

```tsx
import { cookieAdapter } from "@authai-io/react";

configureAuthAI({
  ...,
  storage: cookieAdapter({
    name: "my-app-jwt",        // default: "authai-jwt"
    sameSite: "lax",           // default: "lax"
    secure: true,              // default: auto-on for https
    maxAge: 14 * 24 * 60 * 60, // default: 14d (matches JWT lifetime)
  }),
});
```

Defaults are tuned for production: `sameSite=lax` + `secure` auto-on for https + 14-day maxAge to match the relay's JWT exp. If you set `sameSite: "none"`, the Secure flag is enforced automatically (browsers silently drop SameSite=None cookies without Secure).

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
import { authai, AuthAIUnauthorized } from "@authai-io/server";

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

### Middleware / route guards (`decodeAuthAIToken`)

For route guards where you only need to know "is the user signed in" and "which provider" — without contacting the relay — use the local decode helper:

```ts
import { decodeAuthAIToken } from "@authai-io/server";
import { NextResponse } from "next/server";

export function middleware(req) {
  const jwt = req.cookies.get("authai-jwt")?.value;
  const claims = decodeAuthAIToken(jwt);
  if (!claims) return NextResponse.redirect(new URL("/sign-in", req.url));
}
```

Returns `{ provider, expiresAt, appId } | null`. Never returns the encryption key. Skips the relay round-trip, so it scales linearly with traffic — but accepts the caveat that revoked tokens stay valid until their JWT exp. The relay still enforces revocation on every `/v1/*` call.

## End-to-end example (Next.js App Router)

A minimal working integration in a Next.js 15 app.

**`app/layout.tsx`** — provider at the root:

```tsx
import { cookies } from "next/headers";
import { AuthAIProvider } from "@authai-io/react";

export default async function RootLayout({ children }) {
  const jwt = (await cookies()).get("authai-jwt")?.value ?? null;
  return (
    <html>
      <body>
        <AuthAIProvider
          relayUrl={process.env.NEXT_PUBLIC_AUTHAI_RELAY_URL!}
          appName="My App"
          initialJwt={jwt}
          storage="cookie"
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
import { SignIn, useAuthAI } from "@authai-io/react";
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
import { authai, AuthAIUnauthorized } from "@authai-io/server";

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
2. Frontend either calls `configureAuthAI({ relayUrl, appName })` at module scope (singleton — recommended) OR wraps `<App>` in `<AuthAIProvider relayUrl={...} appName="...">` (provider — SSR / advanced).
3. `<SignIn>` renders the dialog and reaches the provider's device-code page.
4. After authorizing, `useAuthAI().jwt` is a non-null string.
5. Frontend sends `jwt` to your backend on every AI request via `Authorization: Bearer …`.
6. Backend calls `authai.session({ jwt, relayUrl })` and gets `{ user, openai }`.
7. `openai.chat.completions.create({...})` streams text back.
8. `user.id` is the same on re-sign-in for the same account.
