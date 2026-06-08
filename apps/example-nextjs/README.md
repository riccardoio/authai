# example-nextjs — AuthAI SSR demo

Demonstrates server-rendered AuthAI: cookie-backed session storage,
`<AuthAIProvider initialJwt>` for SSR hydration, and
`decodeAuthAIToken()` in server components for routing decisions.

```bash
pnpm install
pnpm dev:relay    # in the repo root, separate terminal
pnpm --filter example-nextjs dev
# open http://localhost:5174
```

Env vars (defaults are fine for local):

| Var                                | Default                       |
| ---------------------------------- | ----------------------------- |
| `NEXT_PUBLIC_AUTHAI_RELAY_URL`     | `https://relay.authai.io`     |
| `AUTHAI_RELAY_URL`                 | `https://relay.authai.io`     |

## What to look for

- `app/layout.tsx` — reads the `authai-jwt` cookie and passes it to
  `<AuthAIProvider initialJwt>`. The page renders signed-in/out
  state correctly on the very first paint.
- `app/page.tsx` — uses `decodeAuthAIToken` server-side to branch
  between "sign in" and "welcome back" without making a relay call.
- `app/dashboard-client.tsx` — the only client island; uses
  `<SignIn>` and `useAuthAI()` for the interactive bits.
- `app/api/chat/route.ts` — calls `authai.session()` on the server
  with the JWT forwarded from the client, streams a chat completion.
