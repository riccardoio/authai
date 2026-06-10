# Changelog

All notable changes to AuthAI are documented here. The format is based on [Keep a Changelog](https://keepachangelog.com/), and versions follow [semver](https://semver.org/).

This file tracks all six npm packages collectively. Per-package CHANGELOGs may be added later if the release cadences diverge.

## [0.2.1] - 2026-06-10

### Fixed

- **`@authai-io/react`**: Keep the provider picker as the visible dialog step while a no-preset singleton sign-in starts the selected provider flow. This fixes a brief consent-screen flash before the device-code screen in apps using `configureAuthAI()` and `<SignIn>` without a preset provider.

## [0.2.0] - 2026-06-10

### Changed

- **`@authai-io/react`**: Connect dialog redesign. The consent step is now a provider-specific trust-bullet screen ("You sign in on OpenAI's site / No new bill / Disconnect anytime") and is shown only when the app presets a provider; `signIn()` with no provider opens the provider picker directly, matching the existing singleton behavior. Every dialog step gains a "Secured by AuthAI" footer linking to the security docs. The code step's primary button now reads "Open ChatGPT" (was "Continue").

## [0.1.1] — 2026-06-09

### Fixed

- **`authai-cloud`** — Declare UTF-8 charset on the CLI listener's success-page HTML response. Previously the "Return to your terminal — the CLI has your key." line rendered as `Return to your terminal â€" the CLI has your key.` because the response had no charset header and browsers fell back to Latin-1.

## [0.1.0] — 2026-06-09

First public release. AuthAI is now installable from npm and AuthAI Cloud is live at [authai.io](https://authai.io) + [relay.authai.io](https://relay.authai.io).

### Added

- **[`@authai-io/react`](https://www.npmjs.com/package/@authai-io/react)** — React SDK with `<SignIn>`, `<AuthAIProvider>`, `useAuthAI()`, and `configureAuthAI()`. Supports ChatGPT, Grok, and GitHub Copilot sign-in. Singleton path for client SPAs and provider path for SSR (Next.js, Remix). Cookie storage adapter for SSR token hand-off. ~6 KB compressed dialog, no Tailwind dependency.
- **[`@authai-io/server`](https://www.npmjs.com/package/@authai-io/server)** — Backend SDK. `authai.session({ jwt, relayUrl })` returns `{ user, apiKey, baseURL, openai? }`. Optional pre-configured OpenAI client when the `openai` peer dep is installed. `decodeAuthAIToken()` for local-only JWT inspection.
- **[`@authai-io/relay`](https://www.npmjs.com/package/@authai-io/relay)** — Core relay (Hono). OAuth device-code flow against ChatGPT/Grok/Copilot, AES-256-GCM per-record encryption with key in JWT, HS256 JWT issue/verify, Chat Completions ↔ Codex Responses translation, `/v1/*` OpenAI-compatible proxy, server-side token refresh.
- **[`@authai-io/relay-store-sqlite`](https://www.npmjs.com/package/@authai-io/relay-store-sqlite)** — SQLite storage driver. Single file, zero infrastructure. Best for self-hosted single-instance.
- **[`@authai-io/relay-store-postgres`](https://www.npmjs.com/package/@authai-io/relay-store-postgres)** — Postgres storage driver. Multi-instance, used by AuthAI Cloud and any horizontally-scaled self-host.
- **[`authai-cloud`](https://www.npmjs.com/package/authai-cloud)** — `npx authai-cloud init` one-command setup. Opens the browser, signs you in with GitHub on authai.io, creates an app, writes `AUTH_AI_SECRET=…` to `.env`. No GitHub OAuth code in the CLI itself — the webapp handles it and POSTs the key back to a local 127.0.0.1 listener.
- **AuthAI Cloud** — Free hosted service at `https://authai.io` (Next.js dashboard) and `https://relay.authai.io` (Hono relay). Same code as self-hosting, deployed on Hetzner via Dokku. Multi-tenant Postgres + Redis. Stores only ciphertext — per-record AES keys still live exclusively in the user's JWT.

### Self-host changes

- **`apps/relay-server`** — `AUTH_AI_DB_DRIVER=postgres` now actually boots (previously hard-exited for anything ≠ `sqlite`). Set `AUTH_AI_DB_URL=postgres://…` and you're done.

### Notes

- The OAuth surfaces AuthAI uses (ChatGPT Codex device code, Grok device code, GitHub Copilot device code) are the same ones the official CLIs use. They are not officially published third-party APIs — providers can change or revoke them. See [the README](./README.md#how-it-works) for the full risk callout.
- AuthAI is not affiliated with OpenAI, GitHub, or xAI.
