# Introduction

AuthAI is an open-source relay that lets users sign in with an existing ChatGPT Plus, Grok, or GitHub Copilot subscription, then routes your app's model calls through that user's plan instead of through your own API key.

## Why this exists

With a normal API key, every user interaction becomes your token bill. That makes it hard to:

- ship a free side project without taking on unpredictable token costs
- build a hackathon demo that survives launch day
- give away an educational tool
- charge a flat fee for a product whose marginal cost is variable
- experiment with prompts at the scale they actually need to be tuned

Meanwhile, your users are already paying for ChatGPT Plus, Copilot Pro, or xAI Premium — typically $20/month — and that subscription comes with a model quota that sits idle the moment they close the official chat UI.

AuthAI shifts the billing source. End users sign in with their existing subscription, and your app makes supported model calls against their plan. **Your app stops paying per token; the user's existing quota is what backs the calls.** Calls are still subject to the provider's rate limits and policies — see [Provider support and risk](#provider-support-and-risk) below.

## What it is, exactly

A self-hostable HTTP relay plus two TypeScript SDKs:

1. **The relay** runs the OAuth device-code flow against each supported provider. It receives the user's OAuth tokens, encrypts them, stores the ciphertext, and hands the user's browser a session JWT. Subsequent model calls go through the relay, which decrypts the tokens just-in-time and forwards to the provider in OpenAI's wire format.
2. **`@authai-io/react`** provides `<AuthAIProvider>`, `<SignIn>`, and `useAuthAI()`. It manages the sign-in UI and exposes a session JWT for your frontend to send to your backend.
3. **`@authai-io/server`** provides `authai.session({ jwt, relayUrl })`, returning `{ user, apiKey, baseURL, openai? }`. Your backend gets an authenticated user and a pre-configured client in one call.

Your frontend sends the JWT to your backend with each AI request, exactly the way you'd send any session token. The relay authenticates upstream using the user's stored provider tokens, so the call is scoped to the user's subscription.

## Provider support and risk

This part matters before you ship anything to production:

- **The OAuth surfaces AuthAI uses are unofficial.** They are the same device-code flows the providers' own CLIs use (Codex CLI, GitHub Copilot CLI, xAI's tooling), but the providers do not publish or guarantee a third-party API contract on top of them.
- **Providers can change or revoke these surfaces at any time** without notice. If that happens, sign-ins or calls for the affected provider will break until AuthAI catches up.
- **Provider terms of service apply.** AuthAI does not extend or modify them. Some providers' subscription terms restrict programmatic access; verify each provider's current terms before you ship.
- **Rate limits and plan restrictions still apply.** A ChatGPT Plus account that hits its quota in the official chat UI will hit the same quota through AuthAI.
- **AuthAI is not affiliated with OpenAI, GitHub, or xAI.**

If your business depends on guaranteed availability, ship with a fallback path: a regular API key or a provider that you control.

## What it's good for

- **Consumer AI products with user-funded inference.** Build features like translation, summarization, code review, or chat without paying provider API costs per request.
- **Side projects and prototypes.** Test ideas without budgeting for tokens you might not use.
- **Educational and demo tools.** Free for students, free for you.
- **Apps with unpredictable usage patterns.** Your operating cost stops scaling linearly with DAU.
- **Multi-tenant AI features.** Each user brings their own AI; you ship the product on top.

## What it isn't

- **Not a bypass.** Calls draw from the user's existing plan quota, just like any other call from the user. Provider rate limits and rules still apply.
- **Not a billing system.** You can charge for your app. AuthAI does not meter, resell, or create access to provider capacity beyond what the user's own subscription already covers.
- **Not a SaaS we run.** AuthAI is the software; you host the relay yourself.
- **Not affiliated with OpenAI, GitHub, or xAI.**
- **Not a substitute for a regular API key.** Use AuthAI where users genuinely have or want to use their own subscription. For freemium, metered SaaS, or guaranteed availability, use a regular API key.

## The components

### The relay (`packages/relay`)

A Hono HTTP server, roughly 2 KLOC. Stateless apart from an encrypted token store. Responsibilities:

- The OAuth device-code dance for each supported provider
- AES-256-GCM encryption of OAuth tokens (per-record key, key only in the user's JWT)
- HS256 JWT issuance and verification
- HMAC-SHA256 user identity hashing (with a separate secret)
- OpenAI-compatible routing: `/v1/chat/completions`, `/v1/responses`, `/v1/models`
- Translation between Chat Completions and Codex Responses when needed (ChatGPT only)
- Server-side token refresh, transparent to the client

You host it. See [Installation](./installation.md).

### `@authai-io/react`

The frontend SDK. Three exports:

- `<AuthAIProvider relayUrl appName theme storage>`: wraps your app and mounts the sign-in dialog
- `<SignIn provider?>`: sign-in button. Without `provider`, the user opens the picker. With it, the user sees provider-specific consent before the provider flow.
- `useAuthAI()`: returns `{ jwt, provider, isSignedIn, signIn, signOut }`

The dialog is a polished modal: provider-specific consent for preset sign-ins, provider picker for no-preset sign-ins, then device-code display, success, or error. Themed via the `theme` prop, ~6 KB compressed, no Tailwind dependency.

### `@authai-io/server`

The backend SDK. One primary entry point:

```ts
const { user, apiKey, baseURL, openai } = await authai.session({
  jwt: req.headers.get("authorization")?.slice("Bearer ".length),
  relayUrl: "https://your-relay.example",
});
```

- `user.id` — opaque, stable, namespaced per provider (HMAC-SHA256)
- `user.provider` — `"openai" | "xai" | "github"`
- `apiKey` + `baseURL` — drop into LangChain, Vercel AI SDK, custom fetch, or any OpenAI-compatible client
- `openai` — pre-configured `openai` SDK instance, present when `openai` is installed as a peer dependency
- `AuthAIUnauthorized` — thrown on missing/invalid/revoked sessions
- 60 s identity cache by default, configurable, pluggable for serverless

### Storage drivers

- `@authai-io/relay-store-sqlite` — single file, zero infrastructure. Good for self-hosted single-instance.
- `@authai-io/relay-store-postgres` — Postgres driver. Multi-instance and AuthAI Cloud use this.

### Provider adapters

Each lives under `packages/relay/src/providers/<id>/`. The contract is small: `requestDeviceCode`, `pollDeviceCode`, `refreshTokens`, `listModels`, `proxyChatCompletions`, and an optional `proxyResponses`.

| Provider             | OAuth                                | Model surface                                       |
| -------------------- | ------------------------------------ | --------------------------------------------------- |
| **ChatGPT**          | Codex CLI device code                | Chat Completions ↔ Codex Responses translation      |
| **Grok (xAI)**       | xAI device code                      | Pass-through to `api.x.ai/v1`                       |
| **GitHub Copilot**   | GitHub device code → Copilot token   | Pass-through to `api.individual.githubcopilot.com`  |

Adding a new provider is mostly writing the adapter. The crypto, identity, and JWT layers are provider-agnostic.

> **On "Codex" in these docs.** When AuthAI says "Codex," it refers to the OAuth device-code flow + Responses API surface that the open-source [OpenAI Codex CLI](https://github.com/openai/codex) uses to authenticate ChatGPT Plus subscriptions. It is not the deprecated Codex code model or the older completions endpoint.

## How it flows

```
end-user browser              app backend                AuthAI relay          provider
       │                              │                            │                  │
       │  ① Sign in via @authai-io/react │                            │                  │
       │ ──────────────────────────────────────────────────────────►                  │
       │ ◄────────────────────────────────────────────────────────  │                  │
       │  ② Session JWT                                             │                  │
       │                              │                            │                  │
       │  ③ JWT in Authorization      │                            │                  │
       │ ────────────────────────────►│                            │                  │
       │                              │  ④ authai.session({ jwt }) │                  │
       │                              │ ─────────────────────────► │                  │
       │                              │ ◄─────────────────────────  │                  │
       │                              │  ⑤ { user, openai, … }     │                  │
       │                              │                            │                  │
       │                              │  ⑥ openai.chat.completions │                  │
       │                              │ ─────────────────────────► │                  │
       │                              │                            │  ⑦ Decrypt &     │
       │                              │                            │     forward      │
       │                              │                            │ ────────────────►│
       │                              │ ◄─────────────────────────  │ ◄────────────── │
       │ ◄────────────────────────────│  ⑧ Streamed response       │                  │
```

Steps ①–② happen once per user session. Steps ③–⑧ happen on every AI request. The provider receives the call authenticated with the user's tokens, so the call is scoped to the user's subscription.

## What's next

- **[Installation](./installation.md)** — self-host the relay in 5 minutes
- **[Integration](./integration.md)** — wire `@authai-io/react` and `@authai-io/server` into your app
- **[Security](./security.md)** — cryptographic primitives, storage model, full threat model
