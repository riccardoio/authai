# Design — chatgpt-connect (MVP)

## Why

App builders today have one expensive option for shipping AI features: bring their own OpenAI API key and eat every end-user request. This project lets end users sign in with their own ChatGPT subscription so the cost stays with them. The app builder ships AI features without paying for tokens.

## What this is — and isn't

It's an MVP demo, not a business. The mechanism piggybacks on OpenAI's Codex CLI: a public OAuth client_id (`app_EMoamEEZ73f0CkXaXp7hrann`) that returns a JWT bearer token usable against `chatgpt.com/backend-api/codex/responses`. openclaw, Hermes, Codex CLI itself, and others use the same client_id — it's the de facto third-party path.

What you get is **not** a standard `sk-` OpenAI API key. It's a JWT scoped to the ChatGPT backend's Codex Responses endpoint. The full OpenAI API (chat completions, embeddings, vision, audio, batch, assistants, fine-tunes) is **not** accessible — only the Codex Responses endpoint.

## Architecture

```
Browser/Node ── /auth/start ──► Relay ──► auth.openai.com
             ◄── userCode + verificationUrl
End user opens verification URL on any device, enters code
Browser/Node ── /auth/poll ───► Relay ──► auth.openai.com
             ◄── tokens
Browser/Node ── chat(...) ─────► chatgpt.com/backend-api/codex/responses
                                  (direct if CORS allows, else via relay)
```

Three components:

- **Relay** (`packages/relay`) — tiny Hono server. Sidesteps the `auth.openai.com` CORS problem because browsers can't POST there directly. Stateless apart from a 15-minute in-memory session map. Never persists tokens in v1.
- **SDK** (`packages/sdk`, npm name `chatgpt-connect`) — framework-agnostic core + React entrypoint. `signInWithChatGPT()` + `createClient().chat()`.
- **Example app** (`apps/example-react`) — Vite + React 18 demo, end-to-end proof.

## OAuth flow (device code)

The flow is the only one that works from a deployed web app (the localhost-redirect PKCE flow only works for CLIs and desktop apps with a local listener):

1. `POST https://auth.openai.com/api/accounts/deviceauth/usercode` with `{client_id}` → `{device_auth_id, user_code, interval}`
2. User visits `https://auth.openai.com/codex/device`, enters `user_code`
3. `POST https://auth.openai.com/api/accounts/deviceauth/token` (polled every `interval` seconds) → `{authorization_code, code_verifier}`
4. `POST https://auth.openai.com/oauth/token` with `grant_type=authorization_code`, `redirect_uri=https://auth.openai.com/deviceauth/callback` → `{access_token, refresh_token, expires_in}`

The `chatgpt-account-id` is extracted from the JWT's `https://api.openai.com/auth.chatgpt_account_id` claim. Model calls send it as a header alongside `Authorization: Bearer <access_token>` and `OpenAI-Beta: responses=experimental`.

## Relay API (v1)

| Method | Path | Returns |
|---|---|---|
| `POST` | `/auth/start` | `{sessionId, userCode, verificationUrl, expiresInMs, pollIntervalMs}` |
| `GET` | `/auth/poll/:sessionId` | `{status: "pending" \| "complete" \| "expired" \| "error", tokens?, error?}` |
| `POST` | `/auth/refresh` | `{tokens}` |

CORS open (`Access-Control-Allow-Origin: *`). The Codex client_id stays server-side so it's never shipped in browser bundles.

## SDK API

```ts
import { signInWithChatGPT, createClient } from "chatgpt-connect";

const tokens = await signInWithChatGPT({
  relayUrl: "http://localhost:3000",
  onVerification: ({ verificationUrl, userCode }) => { /* show UI */ },
});
const client = createClient({ tokens, relayUrl: "http://localhost:3000" });
for await (const chunk of client.chat({ messages: [{ role: "user", content: "hi" }] })) {
  process.stdout.write(chunk.delta);
}
```

```ts
import { useChatGPTAuth } from "chatgpt-connect/react";
const { signIn, status, verificationUrl, userCode, client, signOut } =
  useChatGPTAuth({ relayUrl, storage: "localStorage" });
```

Transport selection: `"direct" | "relay" | "auto"`. `auto` probes `chatgpt.com/backend-api` on first use; falls back to relay if CORS rejects. In Node it always goes direct.

Refresh: auto when `expires - Date.now() < 60_000`.

## What's out of scope for v1

- Server-side encrypted token storage and JWT-pointer model — that's v2.
- Database, user accounts, multi-tenant isolation.
- Tool calling, vision, audio, embeddings — none exist on the Codex Responses endpoint.
- Production-grade error handling, retries, rate-limit backoff.
- npm publish. Local workspace links prove the SDK ergonomics.

## Run it

```bash
pnpm install
pnpm dev:relay    # → http://localhost:3000
pnpm dev:example  # → http://localhost:5173
```

Click "Sign in with ChatGPT," authorize at the verification URL, type into the chat.

## Verification checklist

- [x] Relay `/auth/start` returns a real device code from `auth.openai.com`
- [x] Relay `/auth/poll/:id` returns `{status: "pending"}` until the user authorizes
- [x] Example app boots, renders, and pulls the SDK with no compile errors
- [x] Full interactive sign-in works end-to-end
- [x] Browser calls `chatgpt.com/backend-api/codex/responses` directly — **CORS is open**, so the relay does NOT need a `/chat` proxy. v1 transport stays `"direct"` for browsers.
- [x] JWT `chatgpt-account-id` extraction works (server accepts the header)
- [ ] Reload-and-restore (localStorage rehydration)
- [ ] Refresh-on-expiry path

## Supported models

The Codex Responses endpoint, when authenticated with a ChatGPT subscription, accepts only a fixed set of model names (the same set the Codex CLI uses). `gpt-5` is **not** one of them. Known-good IDs (from openclaw):

- `gpt-5.4`, `gpt-5.4-mini`, `gpt-5.4-pro`, `gpt-5.4-codex`
- `gpt-5.5`, `gpt-5.5-pro`

SDK default is `gpt-5.4`. Sending an unsupported ID returns `400 { detail: "The 'X' model is not supported when using Codex with a ChatGPT account." }`.
