# @authai/react

React SDK for [AuthAI](https://authai.io) — sign your users in with their own AI subscription (ChatGPT, Grok, Copilot). They sign in via OAuth, your app calls models on their behalf, the cost stays on their plan.

## Quick start

For AI codegen tools and quick prototypes, follow the canonical instructions:

> **https://authai.io/llms.txt**

For human-written integration, see [docs/integration.md](https://github.com/riccardoio/authai/blob/main/docs/integration.md).

## API surface

- `configureAuthAI({ relayUrl, appName, appId?, theme?, storage? })` — singleton config (call once at module scope)
- `<AuthAIProvider relayUrl appName initialJwt? appId? ...>` — provider-based config (SSR / multi-tenant)
- `useAuthAI()` → `{ jwt, isSignedIn, provider, signIn, signOut, error, relayUrl, appId }`
- `<SignIn provider?>` — sign-in button with auto-mounted dialog
- `cookieAdapter({ name?, sameSite?, ... })` — cookie storage for SSR
- `isJwtCurrentlyValid(jwt)` — local JWT expiry check (no signature verification)

## Two modes

- **Production (recommended):** server-side `AUTH_AI_SECRET` in a backend / edge function via `@authai/server`'s `authai.session()`.
- **Prototype (browser-direct):** `AUTH_AI_PUBLISHABLE_KEY` in client source via `configureAuthAI({ appId })`. Origin-pinned at the relay.

See https://authai.io/llms.txt for the full decision framework and snippets.
