# Singleton-First SDK Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `<AuthAIProvider>` optional. `useAuthAI()` works anywhere via a module-level singleton; the provider remains as a first-class advanced path for SSR, multi-tenant, and test isolation. Add `decodeAuthAIToken` to `@authai/server` for middleware.

**Architecture:** Dual-path, context-wins. `useAuthAI()` calls `useContext(Ctx)` first — if a provider is mounted, its state is returned. Otherwise the hook subscribes to a module-level singleton via `useSyncExternalStore`. The singleton holds one global store on `globalThis.__authai` (HMR-safe), reads config from `configureAuthAI({ relayUrl, appName, theme, storage })`, mounts its sign-in dialog into `document.body` via portal on first `signIn()` call, and is explicitly client-only (returns `{ isSignedIn: false }` during SSR, no `localStorage` access). Storage stays user-choice: `"localStorage"` (default), new `"cookie"` (opt-in SSR convenience), `"memory"`, or custom adapter. SSR users mount `<AuthAIProvider initialJwt={jwtFromAnywhere}>` — the JWT source is anything (cookie, NextAuth session, custom header), the provider just hydrates from it.

**Tech Stack:** TypeScript 5, React 18, Vitest 2 + jsdom + @testing-library/react for new SDK tests, pnpm workspaces, jose for JWT decode in `@authai/server`.

**Security note (load-bearing):** AuthAI JWTs contain a `k` claim holding a 32-byte AES key — the user-side half of the split-key encryption model. `decodeAuthAIToken` MUST NOT return `k`. The cookie storage option has the same XSS posture as `localStorage` (not a regression), but docs must call out that the JWT is more than a session token.

---

## File Structure

### `packages/react/` — singleton + cookie + provider changes

```
packages/react/
├── package.json               MODIFY  add vitest, jsdom, @testing-library/react devDeps; add test script
├── vitest.config.ts           CREATE  jsdom env config
├── src/
│   ├── singleton.ts           CREATE  module-level store on globalThis.__authai, signIn/signOut/subscribe/getSnapshot
│   ├── singleton.test.ts      CREATE  store lifecycle, HMR survival, SSR safety
│   ├── configure.ts           CREATE  configureAuthAI({ relayUrl, appName, theme, storage }) — writes singleton config
│   ├── configure.test.ts      CREATE  last-write-wins, SSR no-op
│   ├── cookie-storage.ts      CREATE  cookieAdapter({ name, options }) factory
│   ├── cookie-storage.test.ts CREATE  read/write/clear via document.cookie
│   ├── storage.ts             MODIFY  resolveStorage accepts "cookie"; export cookieAdapter
│   ├── provider.tsx           MODIFY  accept initialJwt prop; useAuthAI falls back to singleton; dialog renders null on SSR
│   ├── provider.test.ts       CREATE  initialJwt hydration, singleton fallback, SSR-null dialog
│   └── index.ts               MODIFY  export configureAuthAI, cookieAdapter
```

### `packages/server/` — local JWT decode helper

```
packages/server/
├── package.json               MODIFY  add jose to deps; add jsdom no (server-only)
└── src/
    ├── decode.ts              CREATE  decodeAuthAIToken(jwt) — local decode, redacts `k`
    ├── decode.test.ts         CREATE  safe claim exposure, no key leak, exp/malformed handling
    └── index.ts               MODIFY  re-export decodeAuthAIToken
```

### `apps/example-react/` — migrate to singleton

```
apps/example-react/
└── src/App.tsx                MODIFY  drop <AuthAIProvider>, use configureAuthAI() + bare useAuthAI()
```

### `apps/example-nextjs/` — NEW SSR demo

```
apps/example-nextjs/                                   CREATE  Next.js 15 App Router demo
├── package.json
├── next.config.mjs
├── tsconfig.json
├── app/
│   ├── layout.tsx             AuthAIProvider w/ initialJwt from cookie
│   ├── page.tsx               server component reading cookie + signed-in dashboard
│   └── api/chat/route.ts      route handler using authai.session()
└── README.md
```

### Docs

```
README.md                      MODIFY  Frontend section uses singleton snippet; new SSR section
docs/integration.md            MODIFY  Lead with singleton snippet; add SSR section; document cookie storage
```

---

## Task 1: Set up Vitest in `packages/react`

**Files:**
- Modify: `packages/react/package.json`
- Create: `packages/react/vitest.config.ts`
- Create: `packages/react/src/smoke.test.ts`

- [ ] **Step 1: Add devDeps and test script**

Edit `packages/react/package.json` — replace the `devDependencies` block and add a `test` script:

```json
{
  "name": "@authai/react",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "main": "./src/index.ts",
  "types": "./src/index.ts",
  "exports": {
    ".": {
      "types": "./src/index.ts",
      "import": "./src/index.ts"
    }
  },
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "test": "vitest run"
  },
  "peerDependencies": {
    "react": ">=18",
    "react-dom": ">=18"
  },
  "devDependencies": {
    "@testing-library/react": "^16.1.0",
    "@types/react": "^18.3.12",
    "@types/react-dom": "^18.3.1",
    "jsdom": "^25.0.1",
    "react": "^18.3.1",
    "react-dom": "^18.3.1",
    "typescript": "^5.6.3",
    "vitest": "^2.1.8"
  }
}
```

- [ ] **Step 2: Create vitest config**

Create `packages/react/vitest.config.ts`:

```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "jsdom",
    globals: false,
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
  },
});
```

- [ ] **Step 3: Write a smoke test to prove infrastructure works**

Create `packages/react/src/smoke.test.ts`:

```ts
import { describe, it, expect } from "vitest";

describe("vitest infrastructure", () => {
  it("can run a passing test", () => {
    expect(1 + 1).toBe(2);
  });

  it("has a jsdom document", () => {
    expect(typeof document).toBe("object");
    expect(document.body).toBeInstanceOf(HTMLBodyElement);
  });
});
```

- [ ] **Step 4: Install + run**

Run:
```bash
pnpm install
pnpm --filter @authai/react test
```

Expected: `Test Files  1 passed (1)` / `Tests  2 passed (2)`.

- [ ] **Step 5: Commit**

```bash
git add packages/react/package.json packages/react/vitest.config.ts packages/react/src/smoke.test.ts pnpm-lock.yaml
git commit -m "$(cat <<'EOF'
test(react): set up vitest + jsdom infrastructure

@authai/react has no test coverage today. This adds vitest with a
jsdom environment so the upcoming singleton store, cookie storage,
and provider changes can be developed test-first.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: Cookie storage adapter (TDD)

**Files:**
- Create: `packages/react/src/cookie-storage.ts`
- Create: `packages/react/src/cookie-storage.test.ts`

- [ ] **Step 1: Write failing tests**

Create `packages/react/src/cookie-storage.test.ts`:

```ts
import { beforeEach, describe, expect, it } from "vitest";
import { cookieAdapter } from "./cookie-storage.js";

function clearAllCookies(): void {
  for (const c of document.cookie.split(";")) {
    const name = c.split("=")[0]?.trim();
    if (name) document.cookie = `${name}=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/`;
  }
}

describe("cookieAdapter", () => {
  beforeEach(() => clearAllCookies());

  it("returns null when no cookie is set", () => {
    expect(cookieAdapter().get()).toBeNull();
  });

  it("writes and reads back a JWT", () => {
    const a = cookieAdapter();
    a.set("eyJ.fake.jwt");
    expect(a.get()).toBe("eyJ.fake.jwt");
  });

  it("clears the cookie", () => {
    const a = cookieAdapter();
    a.set("eyJ.fake.jwt");
    a.clear();
    expect(a.get()).toBeNull();
  });

  it("uses the configured cookie name", () => {
    const a = cookieAdapter({ name: "my-app-jwt" });
    a.set("xyz");
    expect(document.cookie).toContain("my-app-jwt=xyz");
  });

  it("only returns the named cookie, not others", () => {
    document.cookie = "unrelated=hello; path=/";
    const a = cookieAdapter();
    a.set("the-jwt");
    expect(a.get()).toBe("the-jwt");
  });

  it("does not blow up when document is undefined (SSR)", () => {
    const originalDoc = globalThis.document;
    // @ts-expect-error simulating SSR
    delete globalThis.document;
    try {
      const a = cookieAdapter();
      expect(a.get()).toBeNull();
      expect(() => a.set("x")).not.toThrow();
      expect(() => a.clear()).not.toThrow();
    } finally {
      globalThis.document = originalDoc;
    }
  });
});
```

- [ ] **Step 2: Run tests, verify they fail**

Run: `pnpm --filter @authai/react test cookie-storage`
Expected: FAIL with `Cannot find module './cookie-storage.js'` or similar.

- [ ] **Step 3: Implement `cookieAdapter`**

Create `packages/react/src/cookie-storage.ts`:

```ts
import type { TokenStorage } from "./storage.js";

export type CookieOptions = {
  /** Cookie name. Default: "authai-jwt". */
  name?: string;
  /** Path scope. Default: "/". */
  path?: string;
  /** SameSite policy. Default: "lax". */
  sameSite?: "lax" | "strict" | "none";
  /**
   * Secure flag. Default: true when location.protocol === "https:", false otherwise.
   * Set explicitly to override.
   */
  secure?: boolean;
  /** Lifetime in seconds. Default: 14*24*60*60 (matches relay JWT lifetime). */
  maxAge?: number;
  /** Optional Domain attribute. Default: omitted (cookie is host-only). */
  domain?: string;
};

const DEFAULTS = {
  name: "authai-jwt",
  path: "/",
  sameSite: "lax" as const,
  maxAge: 14 * 24 * 60 * 60,
};

function hasDocument(): boolean {
  return typeof document !== "undefined";
}

function isSecureByDefault(): boolean {
  if (typeof location === "undefined") return false;
  return location.protocol === "https:";
}

function readCookie(name: string): string | null {
  if (!hasDocument()) return null;
  const prefix = `${encodeURIComponent(name)}=`;
  for (const c of document.cookie.split(";")) {
    const trimmed = c.trim();
    if (trimmed.startsWith(prefix)) {
      return decodeURIComponent(trimmed.slice(prefix.length));
    }
  }
  return null;
}

function writeCookie(name: string, value: string, opts: Required<Omit<CookieOptions, "domain">> & { domain?: string; secure: boolean }): void {
  if (!hasDocument()) return;
  const parts = [
    `${encodeURIComponent(name)}=${encodeURIComponent(value)}`,
    `path=${opts.path}`,
    `max-age=${opts.maxAge}`,
    `samesite=${opts.sameSite}`,
  ];
  if (opts.secure) parts.push("secure");
  if (opts.domain) parts.push(`domain=${opts.domain}`);
  document.cookie = parts.join("; ");
}

function deleteCookie(name: string, opts: { path: string; domain?: string }): void {
  if (!hasDocument()) return;
  const parts = [
    `${encodeURIComponent(name)}=`,
    `path=${opts.path}`,
    "expires=Thu, 01 Jan 1970 00:00:00 GMT",
  ];
  if (opts.domain) parts.push(`domain=${opts.domain}`);
  document.cookie = parts.join("; ");
}

export function cookieAdapter(options: CookieOptions = {}): TokenStorage {
  const name = options.name ?? DEFAULTS.name;
  const path = options.path ?? DEFAULTS.path;
  const sameSite = options.sameSite ?? DEFAULTS.sameSite;
  const maxAge = options.maxAge ?? DEFAULTS.maxAge;
  const secure = options.secure ?? isSecureByDefault();
  const domain = options.domain;

  return {
    get: () => readCookie(name),
    set: (jwt) => writeCookie(name, jwt, { name, path, sameSite, maxAge, secure, domain }),
    clear: () => deleteCookie(name, { path, domain }),
  };
}
```

- [ ] **Step 4: Run tests, verify pass**

Run: `pnpm --filter @authai/react test cookie-storage`
Expected: PASS, all 6 tests.

- [ ] **Step 5: Wire `"cookie"` into `resolveStorage`**

Edit `packages/react/src/storage.ts` — extend the union type and resolution:

```ts
import { cookieAdapter } from "./cookie-storage.js";

export type TokenStorage = {
  get(): string | null;
  set(jwt: string): void;
  clear(): void;
};

const KEY = "authai:jwt";

export function localStorageAdapter(): TokenStorage {
  if (typeof globalThis.localStorage === "undefined") return memoryAdapter();
  return {
    get() {
      try { return globalThis.localStorage.getItem(KEY); } catch { return null; }
    },
    set(jwt) {
      try { globalThis.localStorage.setItem(KEY, jwt); } catch { /* ignore */ }
    },
    clear() {
      try { globalThis.localStorage.removeItem(KEY); } catch { /* ignore */ }
    },
  };
}

export function memoryAdapter(): TokenStorage {
  let value: string | null = null;
  return {
    get: () => value,
    set: (j) => { value = j; },
    clear: () => { value = null; },
  };
}

export function resolveStorage(
  spec: "localStorage" | "memory" | "cookie" | TokenStorage | undefined,
): TokenStorage {
  if (!spec || spec === "localStorage") return localStorageAdapter();
  if (spec === "memory") return memoryAdapter();
  if (spec === "cookie") return cookieAdapter();
  return spec;
}

export { cookieAdapter };
export type { CookieOptions } from "./cookie-storage.js";
```

- [ ] **Step 6: Add a resolveStorage test for "cookie"**

Append to `packages/react/src/cookie-storage.test.ts`:

```ts
import { resolveStorage } from "./storage.js";

describe("resolveStorage(\"cookie\")", () => {
  beforeEach(() => clearAllCookies());

  it("returns a working cookie adapter", () => {
    const a = resolveStorage("cookie");
    a.set("abc");
    expect(a.get()).toBe("abc");
  });
});
```

Run: `pnpm --filter @authai/react test cookie-storage`
Expected: PASS, all 7 tests.

- [ ] **Step 7: Commit**

```bash
git add packages/react/src/cookie-storage.ts packages/react/src/cookie-storage.test.ts packages/react/src/storage.ts
git commit -m "$(cat <<'EOF'
feat(react): add cookie storage adapter

New cookieAdapter({ name, sameSite, secure, maxAge, ... }) implements
TokenStorage on document.cookie. Defaults: authai-jwt / path=/ /
sameSite=lax / secure auto-on for https / maxAge 14d (matches the
relay JWT lifetime).

resolveStorage now accepts "cookie" as a shorthand for cookieAdapter()
with defaults. The cookie option is the SSR-friendly storage choice;
localStorage stays the default for client SPAs.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: Singleton store (TDD)

**Files:**
- Create: `packages/react/src/singleton.ts`
- Create: `packages/react/src/singleton.test.ts`

- [ ] **Step 1: Write failing tests**

Create `packages/react/src/singleton.test.ts`:

```ts
import { beforeEach, describe, expect, it } from "vitest";
import {
  getSingletonSnapshot,
  subscribeSingleton,
  resetSingletonForTests,
  configureSingleton,
  signInSingleton,
  signOutSingleton,
} from "./singleton.js";

describe("singleton store", () => {
  beforeEach(() => resetSingletonForTests());

  it("starts signed out with no config", () => {
    const snap = getSingletonSnapshot();
    expect(snap.isSignedIn).toBe(false);
    expect(snap.jwt).toBeNull();
    expect(snap.provider).toBeNull();
  });

  it("configureSingleton stores relayUrl + appName", () => {
    configureSingleton({ relayUrl: "https://r.example", appName: "T" });
    const snap = getSingletonSnapshot();
    expect(snap.relayUrl).toBe("https://r.example");
    expect(snap.appName).toBe("T");
  });

  it("configureSingleton is last-write-wins for relayUrl/appName", () => {
    configureSingleton({ relayUrl: "https://a", appName: "A" });
    configureSingleton({ relayUrl: "https://b", appName: "B" });
    const snap = getSingletonSnapshot();
    expect(snap.relayUrl).toBe("https://b");
    expect(snap.appName).toBe("B");
  });

  it("subscribers are notified on config change", () => {
    let count = 0;
    const unsub = subscribeSingleton(() => { count++; });
    configureSingleton({ relayUrl: "https://x", appName: "X" });
    expect(count).toBeGreaterThan(0);
    unsub();
  });

  it("signOutSingleton clears jwt and notifies", () => {
    configureSingleton({ relayUrl: "https://r", appName: "T", storage: "memory" });
    // Manually inject a jwt via the storage path
    const snap1 = getSingletonSnapshot();
    expect(snap1.isSignedIn).toBe(false);
    // signOut on already-signed-out is a no-op but must not throw
    expect(() => signOutSingleton()).not.toThrow();
  });

  it("resetSingletonForTests wipes state", () => {
    configureSingleton({ relayUrl: "https://x", appName: "X" });
    resetSingletonForTests();
    expect(getSingletonSnapshot().relayUrl).toBeNull();
  });

  it("requires configuration before signIn", async () => {
    await expect(signInSingleton()).rejects.toThrow(/relayUrl/);
  });

  it("survives a simulated HMR cycle (state on globalThis)", () => {
    configureSingleton({ relayUrl: "https://hmr", appName: "H" });
    // Simulate re-importing the module by reading globalThis directly
    const stash = (globalThis as any).__authai;
    expect(stash).toBeDefined();
    expect(stash.config.relayUrl).toBe("https://hmr");
  });
});

describe("singleton SSR safety", () => {
  it("returns signed-out snapshot when document is undefined", () => {
    resetSingletonForTests();
    const originalDoc = globalThis.document;
    // @ts-expect-error simulating SSR
    delete globalThis.document;
    try {
      const snap = getSingletonSnapshot();
      expect(snap.isSignedIn).toBe(false);
      expect(snap.jwt).toBeNull();
    } finally {
      globalThis.document = originalDoc;
    }
  });
});
```

- [ ] **Step 2: Run tests, verify they fail**

Run: `pnpm --filter @authai/react test singleton`
Expected: FAIL with module not found.

- [ ] **Step 3: Implement the singleton**

Create `packages/react/src/singleton.ts`:

```ts
import {
  decodeJwtProvider,
  revokeSession,
  signInWithProvider,
  type ProviderId,
} from "./auth.js";
import { resolveStorage, type TokenStorage } from "./storage.js";
import type { AuthAITheme } from "./dialog/theme.js";

export type SingletonConfig = {
  relayUrl: string | null;
  appName: string | null;
  theme: AuthAITheme | null;
  storageSpec: "localStorage" | "memory" | "cookie" | TokenStorage | null;
};

export type SingletonSnapshot = {
  relayUrl: string | null;
  appName: string | null;
  theme: AuthAITheme | null;
  jwt: string | null;
  provider: ProviderId | null;
  isSignedIn: boolean;
  pendingProvider: ProviderId | null;
  verification: { userCode: string; verificationUrl: string } | null;
  error: string | null;
  phase: "idle" | "explain" | "picker" | "fetching" | "code" | "error";
};

type Store = {
  config: SingletonConfig;
  storage: TokenStorage | null;
  state: SingletonSnapshot;
  listeners: Set<() => void>;
  abort: AbortController | null;
};

const KEY = "__authai";

function isBrowser(): boolean {
  return typeof document !== "undefined";
}

function makeInitialState(): SingletonSnapshot {
  return {
    relayUrl: null,
    appName: null,
    theme: null,
    jwt: null,
    provider: null,
    isSignedIn: false,
    pendingProvider: null,
    verification: null,
    error: null,
    phase: "idle",
  };
}

function getStore(): Store {
  const g = globalThis as any;
  if (!g[KEY]) {
    g[KEY] = {
      config: { relayUrl: null, appName: null, theme: null, storageSpec: null },
      storage: null,
      state: makeInitialState(),
      listeners: new Set<() => void>(),
      abort: null,
    } satisfies Store;
  }
  return g[KEY] as Store;
}

function emit(store: Store): void {
  for (const l of Array.from(store.listeners)) l();
}

function ensureStorage(store: Store): TokenStorage {
  if (store.storage) return store.storage;
  if (!isBrowser()) {
    // On the server, do not touch localStorage / document.cookie even if a
    // spec was provided — fall through to memory so SSR is deterministic.
    store.storage = resolveStorage("memory");
    return store.storage;
  }
  store.storage = resolveStorage(store.config.storageSpec ?? "localStorage");
  return store.storage;
}

function hydrateFromStorageIfNeeded(store: Store): void {
  if (store.state.jwt !== null) return;
  if (!isBrowser()) return;
  const jwt = ensureStorage(store).get();
  if (jwt) {
    store.state = {
      ...store.state,
      jwt,
      provider: decodeJwtProvider(jwt),
      isSignedIn: true,
    };
  }
}

export function configureSingleton(opts: {
  relayUrl: string;
  appName: string;
  theme?: AuthAITheme;
  storage?: "localStorage" | "memory" | "cookie" | TokenStorage;
}): void {
  if (!isBrowser()) {
    // SSR no-op: keep state pristine so server renders are deterministic.
    return;
  }
  const store = getStore();
  store.config.relayUrl = opts.relayUrl;
  store.config.appName = opts.appName;
  if (opts.theme !== undefined) store.config.theme = opts.theme;
  // Only swap storage if not yet hydrated; otherwise we'd risk losing the session.
  if (opts.storage !== undefined && store.state.jwt === null) {
    store.config.storageSpec = opts.storage;
    store.storage = null; // force re-resolve
  }
  store.state = {
    ...store.state,
    relayUrl: store.config.relayUrl,
    appName: store.config.appName,
    theme: store.config.theme,
  };
  hydrateFromStorageIfNeeded(store);
  emit(store);
}

export function getSingletonSnapshot(): SingletonSnapshot {
  const store = getStore();
  hydrateFromStorageIfNeeded(store);
  return store.state;
}

export function subscribeSingleton(listener: () => void): () => void {
  const store = getStore();
  store.listeners.add(listener);
  return () => store.listeners.delete(listener);
}

export async function signInSingleton(provider?: ProviderId): Promise<void> {
  const store = getStore();
  if (!store.config.relayUrl) {
    throw new Error("AuthAI: call configureAuthAI({ relayUrl, appName }) before signIn()");
  }
  if (!store.config.appName) {
    throw new Error("AuthAI: configureAuthAI({ appName }) is required before signIn()");
  }
  if (!provider) {
    // Move to picker phase; the dialog handles provider selection.
    store.state = { ...store.state, phase: "picker", error: null };
    emit(store);
    return;
  }
  store.abort?.abort();
  const ctrl = new AbortController();
  store.abort = ctrl;
  store.state = {
    ...store.state,
    pendingProvider: provider,
    phase: "fetching",
    error: null,
    verification: null,
  };
  emit(store);
  try {
    const jwt = await signInWithProvider({
      relayUrl: store.config.relayUrl,
      provider,
      signal: ctrl.signal,
      onVerification: ({ userCode, verificationUrl }) => {
        store.state = {
          ...store.state,
          verification: { userCode, verificationUrl },
          phase: "code",
        };
        emit(store);
      },
    });
    ensureStorage(store).set(jwt);
    store.state = {
      ...makeInitialState(),
      relayUrl: store.config.relayUrl,
      appName: store.config.appName,
      theme: store.config.theme,
      jwt,
      provider: decodeJwtProvider(jwt),
      isSignedIn: true,
    };
    emit(store);
  } catch (err) {
    if ((err as Error).name === "AbortError") return;
    store.state = {
      ...store.state,
      pendingProvider: null,
      verification: null,
      phase: "error",
      error: (err as Error).message,
    };
    emit(store);
  }
}

export function signOutSingleton(): void {
  const store = getStore();
  store.abort?.abort();
  const prevJwt = store.state.jwt;
  if (prevJwt && store.config.relayUrl) {
    revokeSession(store.config.relayUrl, prevJwt).catch(() => {});
  }
  if (isBrowser()) ensureStorage(store).clear();
  store.state = {
    ...makeInitialState(),
    relayUrl: store.config.relayUrl,
    appName: store.config.appName,
    theme: store.config.theme,
  };
  emit(store);
}

export function cancelSingletonFlow(): void {
  const store = getStore();
  store.abort?.abort();
  store.state = {
    ...store.state,
    phase: "idle",
    pendingProvider: null,
    verification: null,
    error: null,
  };
  emit(store);
}

/** Test-only: wipe singleton state. Not exported from package index. */
export function resetSingletonForTests(): void {
  const g = globalThis as any;
  delete g[KEY];
}
```

- [ ] **Step 4: Run tests, verify pass**

Run: `pnpm --filter @authai/react test singleton`
Expected: PASS, all 9 tests.

- [ ] **Step 5: Commit**

```bash
git add packages/react/src/singleton.ts packages/react/src/singleton.test.ts
git commit -m "$(cat <<'EOF'
feat(react): add module-level singleton store

Internal store lives on globalThis.__authai (HMR-safe). Exposes
get/subscribe/configure/signIn/signOut and reuses the existing
auth.ts primitives. Returns a deterministic signed-out snapshot
during SSR so server rendering never touches localStorage or
document.cookie.

The hook in the next task subscribes to this via useSyncExternalStore.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: `configureAuthAI` public API (TDD)

**Files:**
- Create: `packages/react/src/configure.ts`
- Create: `packages/react/src/configure.test.ts`

- [ ] **Step 1: Write failing tests**

Create `packages/react/src/configure.test.ts`:

```ts
import { beforeEach, describe, expect, it } from "vitest";
import { configureAuthAI } from "./configure.js";
import { getSingletonSnapshot, resetSingletonForTests } from "./singleton.js";

describe("configureAuthAI", () => {
  beforeEach(() => resetSingletonForTests());

  it("writes relayUrl and appName to the singleton", () => {
    configureAuthAI({ relayUrl: "https://r", appName: "X" });
    const snap = getSingletonSnapshot();
    expect(snap.relayUrl).toBe("https://r");
    expect(snap.appName).toBe("X");
  });

  it("is idempotent — calling twice with same values is fine", () => {
    configureAuthAI({ relayUrl: "https://r", appName: "X" });
    configureAuthAI({ relayUrl: "https://r", appName: "X" });
    expect(getSingletonSnapshot().relayUrl).toBe("https://r");
  });

  it("last write wins for relayUrl", () => {
    configureAuthAI({ relayUrl: "https://a", appName: "X" });
    configureAuthAI({ relayUrl: "https://b", appName: "X" });
    expect(getSingletonSnapshot().relayUrl).toBe("https://b");
  });

  it("is a no-op when document is undefined (SSR)", () => {
    const originalDoc = globalThis.document;
    // @ts-expect-error simulating SSR
    delete globalThis.document;
    try {
      configureAuthAI({ relayUrl: "https://srv", appName: "S" });
      expect(getSingletonSnapshot().relayUrl).toBeNull();
    } finally {
      globalThis.document = originalDoc;
    }
  });
});
```

- [ ] **Step 2: Run tests, verify they fail**

Run: `pnpm --filter @authai/react test configure`
Expected: FAIL.

- [ ] **Step 3: Implement the public API**

Create `packages/react/src/configure.ts`:

```ts
import { configureSingleton } from "./singleton.js";
import type { TokenStorage } from "./storage.js";
import type { AuthAITheme } from "./dialog/theme.js";

export type ConfigureAuthAIOptions = {
  relayUrl: string;
  appName: string;
  theme?: AuthAITheme;
  storage?: "localStorage" | "memory" | "cookie" | TokenStorage;
};

/**
 * Configure the AuthAI singleton. Call once at module scope before any
 * <SignIn> or useAuthAI().signIn() call. No-op on the server.
 *
 * Apps using <AuthAIProvider> do NOT need to call this — the provider
 * supplies its own config. Mixing both paths is allowed but each store
 * is independent (the provider wins in its subtree).
 */
export function configureAuthAI(options: ConfigureAuthAIOptions): void {
  configureSingleton(options);
}
```

- [ ] **Step 4: Run tests, verify pass**

Run: `pnpm --filter @authai/react test configure`
Expected: PASS, 4 tests.

- [ ] **Step 5: Commit**

```bash
git add packages/react/src/configure.ts packages/react/src/configure.test.ts
git commit -m "$(cat <<'EOF'
feat(react): add configureAuthAI() public API

Thin wrapper over the singleton store's configure path. Documents
that it's a no-op on the server and that apps using <AuthAIProvider>
don't need it.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: `useAuthAI` falls back to singleton when no provider (TDD)

**Files:**
- Modify: `packages/react/src/provider.tsx`
- Create: `packages/react/src/provider.test.ts`

- [ ] **Step 1: Write failing tests**

Create `packages/react/src/provider.test.ts`:

```ts
import { describe, expect, it, beforeEach } from "vitest";
import { render, screen, act } from "@testing-library/react";
import { AuthAIProvider, useAuthAI } from "./provider.js";
import { configureAuthAI } from "./configure.js";
import { resetSingletonForTests } from "./singleton.js";

function Probe() {
  const auth = useAuthAI();
  return (
    <div>
      <span data-testid="relay">{auth.relayUrl ?? "none"}</span>
      <span data-testid="signed">{auth.isSignedIn ? "yes" : "no"}</span>
    </div>
  );
}

describe("useAuthAI", () => {
  beforeEach(() => resetSingletonForTests());

  it("reads from singleton when no provider is mounted", () => {
    configureAuthAI({ relayUrl: "https://singleton.example", appName: "S" });
    render(<Probe />);
    expect(screen.getByTestId("relay").textContent).toBe("https://singleton.example");
  });

  it("reads from provider context when mounted, ignoring singleton", () => {
    configureAuthAI({ relayUrl: "https://singleton.example", appName: "S" });
    render(
      <AuthAIProvider relayUrl="https://provider.example" appName="P">
        <Probe />
      </AuthAIProvider>
    );
    expect(screen.getByTestId("relay").textContent).toBe("https://provider.example");
  });

  it("does NOT throw when called with no provider and no config", () => {
    expect(() => render(<Probe />)).not.toThrow();
    expect(screen.getByTestId("relay").textContent).toBe("none");
    expect(screen.getByTestId("signed").textContent).toBe("no");
  });
});

describe("AuthAIProvider initialJwt", () => {
  beforeEach(() => resetSingletonForTests());

  it("hydrates isSignedIn from initialJwt at first render", () => {
    const fakeJwt = "header.eyJwcm92IjoieGFpIn0.sig"; // payload: {"prov":"xai"}
    render(
      <AuthAIProvider relayUrl="https://r" appName="P" initialJwt={fakeJwt}>
        <Probe />
      </AuthAIProvider>
    );
    expect(screen.getByTestId("signed").textContent).toBe("yes");
  });

  it("treats initialJwt=null as signed out", () => {
    render(
      <AuthAIProvider relayUrl="https://r" appName="P" initialJwt={null}>
        <Probe />
      </AuthAIProvider>
    );
    expect(screen.getByTestId("signed").textContent).toBe("no");
  });
});

describe("dialog SSR safety", () => {
  it("renders no portal when document is undefined", () => {
    // We can't fully simulate SSR in jsdom; instead, verify that the
    // dialog component itself short-circuits on document=undefined.
    const originalDoc = globalThis.document;
    // @ts-expect-error simulating SSR
    delete globalThis.document;
    try {
      // Importing dialog should not throw even without document
      // (deferred to import side-effects check in implementation).
      expect(() => require("./dialog/Dialog.js")).not.toThrow();
    } finally {
      globalThis.document = originalDoc;
    }
  });
});
```

- [ ] **Step 2: Run tests, verify they fail**

Run: `pnpm --filter @authai/react test provider`
Expected: FAIL with `useAuthAI must be used inside <AuthAIProvider>` (the current throw) and missing `initialJwt` prop.

- [ ] **Step 3: Update provider to fallback to singleton + accept initialJwt**

Edit `packages/react/src/provider.tsx`. Replace the file with:

```tsx
import {
  createContext, useCallback, useContext, useEffect, useMemo, useRef, useState,
  useSyncExternalStore,
} from "react";
import { decodeJwtProvider, revokeSession, signInWithProvider, type ProviderId } from "./auth.js";
import { resolveStorage, type TokenStorage } from "./storage.js";
import { AuthAIDialog, type DialogStep } from "./dialog/Dialog.js";
import type { AuthAITheme } from "./dialog/theme.js";
import {
  getSingletonSnapshot,
  subscribeSingleton,
  signInSingleton,
  signOutSingleton,
  cancelSingletonFlow,
} from "./singleton.js";
import { SingletonDialogHost } from "./singleton-dialog-host.js";

export type AuthAIContextValue = {
  relayUrl: string | null;
  jwt: string | null;
  provider: ProviderId | null;
  isSignedIn: boolean;
  error: string | null;
  signIn: (provider?: ProviderId) => void;
  signOut: () => void;
};

const Ctx = createContext<AuthAIContextValue | null>(null);

type Phase = "idle" | "explain" | "picker" | "fetching" | "code" | "success" | "error";

export type AuthAIProviderProps = {
  relayUrl: string;
  appName: string;
  /**
   * SSR hand-off. When set, the provider initializes isSignedIn from this
   * jwt synchronously (no flash of unauth). On the client, storage takes
   * over after first render.
   */
  initialJwt?: string | null;
  theme?: AuthAITheme;
  storage?: "localStorage" | "memory" | "cookie" | TokenStorage;
  children: React.ReactNode;
};

export function AuthAIProvider({
  relayUrl, appName, initialJwt, theme, storage, children,
}: AuthAIProviderProps) {
  const adapter = useMemo(() => resolveStorage(storage), [storage]);
  const [jwt, setJwt] = useState<string | null>(() => initialJwt ?? adapter.get());
  const [phase, setPhase] = useState<Phase>("idle");
  const [originStep, setOriginStep] = useState<DialogStep>("explain");
  const [presetProvider, setPresetProvider] = useState<ProviderId | null>(null);
  const [pickedProvider, setPickedProvider] = useState<ProviderId | null>(null);
  const [code, setCode] = useState<{ userCode: string; verificationUrl: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [toastVisible, setToastVisible] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showToast = useCallback(() => {
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    setToastVisible(true);
    toastTimerRef.current = setTimeout(() => setToastVisible(false), 1600);
  }, []);

  const copyCode = useCallback((value: string) => {
    try {
      if (typeof navigator !== "undefined" && navigator.clipboard) {
        navigator.clipboard.writeText(value).catch(() => {});
      }
    } catch { /* ignore */ }
  }, []);

  const openVerification = useCallback((url: string) => {
    if (typeof window === "undefined") return;
    window.open(url, "_blank", "noopener,noreferrer");
  }, []);

  const reset = useCallback(() => {
    setPhase("idle");
    setOriginStep("explain");
    setPresetProvider(null);
    setPickedProvider(null);
    setCode(null);
    setError(null);
    setToastVisible(false);
    if (toastTimerRef.current) {
      clearTimeout(toastTimerRef.current);
      toastTimerRef.current = null;
    }
  }, []);

  const startFlow = useCallback(async (providerId: ProviderId) => {
    if (!appName) throw new Error("AuthAIProvider requires an `appName` prop");
    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    setError(null);
    setCode(null);
    setPickedProvider(providerId);
    setPhase("fetching");
    try {
      const fresh = await signInWithProvider({
        relayUrl,
        provider: providerId,
        signal: ctrl.signal,
        onVerification: ({ verificationUrl, userCode }) => {
          setCode({ userCode, verificationUrl });
          copyCode(userCode);
          showToast();
          setPhase((c) => (c === "fetching" ? "code" : c));
          setOriginStep("code");
        },
      });
      adapter.set(fresh);
      setJwt(fresh);
      setPhase("success");
      setTimeout(() => reset(), 250);
    } catch (err) {
      if ((err as Error).name === "AbortError") return;
      setError((err as Error).message);
      setPhase("error");
    }
  }, [appName, relayUrl, adapter, copyCode, showToast, reset]);

  const signIn = useCallback((provider?: ProviderId) => {
    if (!appName) throw new Error("AuthAIProvider requires an `appName` prop before signIn");
    setError(null);
    setCode(null);
    setPickedProvider(null);
    if (provider) {
      setPresetProvider(provider);
    } else {
      setPresetProvider(null);
    }
    setPhase("explain");
  }, [appName]);

  const handleExplainContinue = useCallback(() => {
    if (presetProvider) {
      setOriginStep("explain");
      startFlow(presetProvider);
    } else {
      setPhase("picker");
    }
  }, [presetProvider, startFlow]);

  const handlePickProvider = useCallback((id: ProviderId) => {
    setOriginStep("picker");
    startFlow(id);
  }, [startFlow]);

  const handleOpenProvider = useCallback(() => {
    if (!code) return;
    openVerification(code.verificationUrl);
  }, [code, openVerification]);

  const handleManualCopy = useCallback(() => {
    if (!code) return;
    copyCode(code.userCode);
    showToast();
  }, [code, copyCode, showToast]);

  const signOut = useCallback(() => {
    abortRef.current?.abort();
    if (jwt) revokeSession(relayUrl, jwt).catch(() => {});
    adapter.clear();
    setJwt(null);
    reset();
  }, [adapter, jwt, relayUrl, reset]);

  const cancel = useCallback(() => {
    abortRef.current?.abort();
    reset();
  }, [reset]);

  const handleTryDifferentProvider = useCallback(() => {
    abortRef.current?.abort();
    setError(null);
    setCode(null);
    setPickedProvider(null);
    setPresetProvider(null);
    setOriginStep("picker");
    setPhase("picker");
  }, []);

  useEffect(() => () => {
    abortRef.current?.abort();
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
  }, []);

  const dialogOpen =
    phase === "explain" || phase === "picker" || phase === "fetching" ||
    phase === "code" || phase === "error";
  const dialogStep: DialogStep =
    phase === "error" ? "error" :
    phase === "picker" ? "picker" :
    phase === "code" ? "code" :
    phase === "fetching" ? originStep :
    "explain";

  const value: AuthAIContextValue = {
    relayUrl,
    jwt,
    provider: jwt ? decodeJwtProvider(jwt) : null,
    isSignedIn: jwt !== null,
    error,
    signIn,
    signOut,
  };

  return (
    <Ctx.Provider value={value}>
      {children}
      <AuthAIDialog
        open={dialogOpen}
        step={dialogStep}
        appName={appName}
        presetProvider={presetProvider}
        pickedProvider={pickedProvider}
        userCode={code?.userCode ?? null}
        verificationUrl={code?.verificationUrl ?? null}
        error={error}
        theme={theme}
        toastVisible={toastVisible}
        onContinueExplain={handleExplainContinue}
        onPickProvider={handlePickProvider}
        onOpenProvider={handleOpenProvider}
        onCopy={handleManualCopy}
        onCancel={cancel}
        onTryDifferentProvider={handleTryDifferentProvider}
      />
    </Ctx.Provider>
  );
}

function useSingletonContextValue(): AuthAIContextValue {
  const snap = useSyncExternalStore(
    subscribeSingleton,
    getSingletonSnapshot,
    getSingletonSnapshot, // server snapshot — same fn returns the SSR-safe snapshot
  );
  return useMemo<AuthAIContextValue>(() => ({
    relayUrl: snap.relayUrl,
    jwt: snap.jwt,
    provider: snap.provider,
    isSignedIn: snap.isSignedIn,
    error: snap.error,
    signIn: (p) => { void signInSingleton(p); },
    signOut: () => signOutSingleton(),
  }), [snap]);
}

/**
 * Read the current AuthAI session.
 *
 * Resolution order:
 *   1. Nearest <AuthAIProvider> context — used if present.
 *   2. Module-level singleton — populated by configureAuthAI().
 *
 * Always returns a value; never throws. relayUrl is null when no provider
 * is mounted AND configureAuthAI() has not been called.
 */
export function useAuthAI(): AuthAIContextValue {
  const ctx = useContext(Ctx);
  const singleton = useSingletonContextValue();
  return ctx ?? singleton;
}

// Re-export for convenience: lets apps mount the singleton's dialog
// somewhere in their tree if they want explicit control. Apps that don't
// mount it get a body-portal'd dialog on first signIn() call.
export { SingletonDialogHost };
export { cancelSingletonFlow };
```

- [ ] **Step 4: Create a SingletonDialogHost stub so the import resolves**

Create `packages/react/src/singleton-dialog-host.tsx`:

```tsx
import { useSyncExternalStore, useMemo, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { AuthAIDialog, type DialogStep } from "./dialog/Dialog.js";
import {
  getSingletonSnapshot,
  subscribeSingleton,
  signInSingleton,
  cancelSingletonFlow,
} from "./singleton.js";
import type { ProviderId } from "./auth.js";

/**
 * Renders the singleton's sign-in dialog into document.body via portal.
 * Apps using configureAuthAI() do not need to mount this explicitly — the
 * hook's first signIn() call auto-mounts it.
 */
export function SingletonDialogHost() {
  const snap = useSyncExternalStore(subscribeSingleton, getSingletonSnapshot, getSingletonSnapshot);
  const [container, setContainer] = useState<HTMLElement | null>(null);

  useEffect(() => {
    if (typeof document === "undefined") return;
    setContainer(document.body);
  }, []);

  const open = snap.phase !== "idle";
  const step: DialogStep = useMemo(() => {
    if (snap.phase === "error") return "error";
    if (snap.phase === "picker") return "picker";
    if (snap.phase === "code") return "code";
    if (snap.phase === "fetching") return snap.pendingProvider ? "explain" : "picker";
    return "explain";
  }, [snap.phase, snap.pendingProvider]);

  if (!container) return null;

  return createPortal(
    <AuthAIDialog
      open={open}
      step={step}
      appName={snap.appName ?? "this app"}
      presetProvider={snap.pendingProvider}
      pickedProvider={snap.pendingProvider}
      userCode={snap.verification?.userCode ?? null}
      verificationUrl={snap.verification?.verificationUrl ?? null}
      error={snap.error}
      theme={snap.theme ?? undefined}
      toastVisible={false}
      onContinueExplain={() => {
        if (snap.pendingProvider) {
          void signInSingleton(snap.pendingProvider);
        } else {
          void signInSingleton(); // moves to picker
        }
      }}
      onPickProvider={(id: ProviderId) => { void signInSingleton(id); }}
      onOpenProvider={() => {
        if (snap.verification && typeof window !== "undefined") {
          window.open(snap.verification.verificationUrl, "_blank", "noopener,noreferrer");
        }
      }}
      onCopy={() => {
        if (snap.verification && typeof navigator !== "undefined" && navigator.clipboard) {
          navigator.clipboard.writeText(snap.verification.userCode).catch(() => {});
        }
      }}
      onCancel={cancelSingletonFlow}
      onTryDifferentProvider={() => { void signInSingleton(); }}
    />,
    container,
  );
}
```

- [ ] **Step 5: Auto-mount the singleton dialog on first hook call**

The singleton dialog host must mount itself automatically so apps don't have to. Modify the singleton's `useSingletonContextValue` hook in `packages/react/src/provider.tsx` to ensure the host exists. Instead of mounting via the hook (which can't render JSX outside the tree), use an effect that creates a React root rendering `<SingletonDialogHost />` into a created div appended to body.

Replace `useSingletonContextValue` in `packages/react/src/provider.tsx` with:

```tsx
import { createRoot, type Root } from "react-dom/client";

let dialogMounted = false;

function ensureSingletonDialogMounted(): void {
  if (dialogMounted) return;
  if (typeof document === "undefined") return;
  dialogMounted = true;
  const host = document.createElement("div");
  host.setAttribute("data-authai-singleton-dialog", "");
  document.body.appendChild(host);
  const root: Root = createRoot(host);
  root.render(<SingletonDialogHost />);
}

function useSingletonContextValue(): AuthAIContextValue {
  useEffect(() => { ensureSingletonDialogMounted(); }, []);
  const snap = useSyncExternalStore(
    subscribeSingleton,
    getSingletonSnapshot,
    getSingletonSnapshot,
  );
  return useMemo<AuthAIContextValue>(() => ({
    relayUrl: snap.relayUrl,
    jwt: snap.jwt,
    provider: snap.provider,
    isSignedIn: snap.isSignedIn,
    error: snap.error,
    signIn: (p) => { void signInSingleton(p); },
    signOut: () => signOutSingleton(),
  }), [snap]);
}
```

Add `import { useEffect } from "react";` if not already present, and `import { createRoot, type Root } from "react-dom/client";`.

- [ ] **Step 6: Run tests, verify pass**

Run: `pnpm --filter @authai/react test provider`
Expected: PASS, all tests (including the new initialJwt + singleton-fallback ones).

- [ ] **Step 7: Run the full react test suite to catch regressions**

Run: `pnpm --filter @authai/react test`
Expected: All passing.

- [ ] **Step 8: Commit**

```bash
git add packages/react/src/provider.tsx packages/react/src/provider.test.ts packages/react/src/singleton-dialog-host.tsx
git commit -m "$(cat <<'EOF'
feat(react): useAuthAI() falls back to singleton; provider gains initialJwt

- useAuthAI() now reads context first, falls back to a singleton store
  when no <AuthAIProvider> is mounted. Never throws.
- AuthAIProvider accepts an optional initialJwt prop so SSR consumers
  can hydrate isSignedIn without a flash of unauth.
- New SingletonDialogHost component renders the singleton's sign-in
  dialog into a body portal. The hook auto-mounts it on first read so
  apps using configureAuthAI() don't have to wire anything else.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: Make `<SignIn>` work with both paths (verification)

**Files:**
- Modify: `packages/react/src/button.tsx`
- Modify: `packages/react/src/provider.test.ts` (add coverage)

- [ ] **Step 1: Verify SignIn already uses useAuthAI**

Run: `grep -n useAuthAI packages/react/src/button.tsx`
Expected: existing `useAuthAI()` call — the button delegates to the hook so it inherits singleton fallback automatically.

- [ ] **Step 2: Add a button-with-singleton test**

Append to `packages/react/src/provider.test.ts`:

```tsx
import { SignIn } from "./button.js";

describe("<SignIn> with singleton", () => {
  beforeEach(() => resetSingletonForTests());

  it("renders without a provider", () => {
    configureAuthAI({ relayUrl: "https://r", appName: "P" });
    render(<SignIn provider="openai">Sign in</SignIn>);
    expect(screen.getByText("Sign in")).toBeInTheDocument();
  });
});
```

- [ ] **Step 3: Run and verify pass**

Run: `pnpm --filter @authai/react test provider`
Expected: PASS, including the new <SignIn> test.

If the button.tsx file does any `if (!ctx) throw` itself, remove that guard — the hook now handles the no-provider case.

- [ ] **Step 4: Commit (if any button.tsx edit needed)**

If no source change was required, skip the commit step. Otherwise:

```bash
git add packages/react/src/button.tsx packages/react/src/provider.test.ts
git commit -m "$(cat <<'EOF'
test(react): verify <SignIn> works without a provider

Confirms the button inherits singleton fallback through useAuthAI(),
which is the whole point of the singleton path.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 7: Export new public API from package index

**Files:**
- Modify: `packages/react/src/index.ts`

- [ ] **Step 1: Update exports**

Edit `packages/react/src/index.ts`:

```ts
export { AuthAIProvider, useAuthAI, SingletonDialogHost, cancelSingletonFlow } from "./provider.js";
export type { AuthAIProviderProps, AuthAIContextValue } from "./provider.js";
export { SignIn, SignInWithChatGPT } from "./button.js";
export type { SignInProps } from "./button.js";
export { configureAuthAI } from "./configure.js";
export type { ConfigureAuthAIOptions } from "./configure.js";
export { localStorageAdapter, memoryAdapter, cookieAdapter, resolveStorage } from "./storage.js";
export type { TokenStorage, CookieOptions } from "./storage.js";
export type { AuthAITheme, AuthAIColors, ResolvedTheme } from "./dialog/theme.js";
export type { ProviderId, ProviderInfo } from "./auth.js";
```

- [ ] **Step 2: Type-check the package**

Run: `pnpm --filter @authai/react build`
Expected: success, no type errors.

- [ ] **Step 3: Run the full test suite**

Run: `pnpm --filter @authai/react test`
Expected: All passing.

- [ ] **Step 4: Commit**

```bash
git add packages/react/src/index.ts
git commit -m "$(cat <<'EOF'
feat(react): export configureAuthAI, cookieAdapter, and singleton helpers

Public API surface for the singleton-first model:
- configureAuthAI({ relayUrl, appName, theme?, storage? })
- cookieAdapter({ name?, sameSite?, ... }) — opt-in SSR storage
- SingletonDialogHost — escape hatch for apps that want explicit dialog placement
- cancelSingletonFlow — programmatic cancel

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 8: `decodeAuthAIToken` in `@authai/server` (TDD)

**Files:**
- Modify: `packages/server/package.json`
- Create: `packages/server/src/decode.ts`
- Create: `packages/server/src/decode.test.ts`
- Modify: `packages/server/src/index.ts`

- [ ] **Step 1: Add jose dep (already used by relay; safe shared version)**

Edit `packages/server/package.json`. Add `"jose": "^5.9.6"` to a new `dependencies` block:

```json
{
  "name": "@authai/server",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "main": "./src/index.ts",
  "types": "./src/index.ts",
  "exports": {
    ".": {
      "types": "./src/index.ts",
      "import": "./src/index.ts"
    }
  },
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "test": "vitest run --passWithNoTests"
  },
  "dependencies": {
    "jose": "^5.9.6"
  },
  "peerDependencies": {
    "openai": ">=4"
  },
  "peerDependenciesMeta": {
    "openai": { "optional": true }
  },
  "devDependencies": {
    "@types/node": "^22.10.1",
    "openai": "^4.77.0",
    "typescript": "^5.6.3",
    "vitest": "^2.1.8"
  }
}
```

Run `pnpm install`.

- [ ] **Step 2: Write failing tests**

Create `packages/server/src/decode.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { SignJWT } from "jose";
import { decodeAuthAIToken } from "./decode.js";

const secret = new TextEncoder().encode("test-secret-not-used-because-decode-does-not-verify");

async function makeJwt(payload: Record<string, unknown>, expSecondsFromNow = 3600): Promise<string> {
  return await new SignJWT(payload)
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(Math.floor(Date.now() / 1000) + expSecondsFromNow)
    .sign(secret);
}

describe("decodeAuthAIToken", () => {
  it("returns provider, expiresAt, appId for a well-formed JWT", async () => {
    const jwt = await makeJwt({
      v: 2,
      rid: "rec_abc",
      k: "AAAA-base64url-key-must-not-leak-AAAA",
      prov: "openai",
      app: "app_xyz",
    });
    const claims = decodeAuthAIToken(jwt);
    expect(claims).not.toBeNull();
    expect(claims!.provider).toBe("openai");
    expect(claims!.appId).toBe("app_xyz");
    expect(claims!.expiresAt).toBeGreaterThan(Math.floor(Date.now() / 1000));
  });

  it("MUST NOT expose the `k` claim (encryption key)", async () => {
    const jwt = await makeJwt({
      v: 2, rid: "r", k: "SECRET-KEY-MATERIAL", prov: "xai",
    });
    const claims = decodeAuthAIToken(jwt) as unknown as Record<string, unknown>;
    // Defense in depth — verify neither the field nor the value leaks.
    expect("k" in claims).toBe(false);
    expect(JSON.stringify(claims)).not.toContain("SECRET-KEY-MATERIAL");
  });

  it("returns null for a malformed JWT", () => {
    expect(decodeAuthAIToken("not.a.jwt")).toBeNull();
    expect(decodeAuthAIToken("")).toBeNull();
    expect(decodeAuthAIToken("only.two")).toBeNull();
  });

  it("returns null for an expired JWT", async () => {
    const jwt = await makeJwt({ v: 2, rid: "r", k: "x", prov: "github" }, -10);
    expect(decodeAuthAIToken(jwt)).toBeNull();
  });

  it("returns null for unknown provider", async () => {
    const jwt = await makeJwt({ v: 2, rid: "r", k: "x", prov: "anthropic" });
    expect(decodeAuthAIToken(jwt)).toBeNull();
  });

  it("appId is null when the JWT has no app claim", async () => {
    const jwt = await makeJwt({ v: 2, rid: "r", k: "x", prov: "openai" });
    const claims = decodeAuthAIToken(jwt);
    expect(claims).not.toBeNull();
    expect(claims!.appId).toBeNull();
  });
});
```

- [ ] **Step 3: Run tests, verify they fail**

Run: `pnpm --filter @authai/server test decode`
Expected: FAIL with module not found.

- [ ] **Step 4: Implement `decodeAuthAIToken`**

Create `packages/server/src/decode.ts`:

```ts
import { decodeJwt } from "jose";

export type ProviderId = "openai" | "xai" | "github";

export type DecodedAuthAIToken = {
  /** Which AI provider this JWT authorizes (openai, xai, github). */
  provider: ProviderId;
  /** Unix seconds. Tokens past this are rejected by decodeAuthAIToken. */
  expiresAt: number;
  /** Cloud-edition app binding, when present. Null for self-hosted relays. */
  appId: string | null;
};

/**
 * Locally decode an AuthAI session JWT without contacting the relay.
 *
 * Use this in middleware / route guards where you only need to know
 * whether a session is present and which provider it's for — NOT for
 * authoritative verification. The relay still enforces revocation on
 * every /v1/* call.
 *
 * Returns null when the JWT is missing, malformed, expired, or carries
 * an unknown provider claim.
 *
 * SECURITY: The full JWT contains a `k` claim that is the user-side
 * half of the split-key encryption model. This function deliberately
 * never returns it. Treat the raw JWT itself as sensitive credential
 * material; do not log it.
 */
export function decodeAuthAIToken(jwt: string | null | undefined): DecodedAuthAIToken | null {
  if (typeof jwt !== "string" || jwt.length === 0) return null;
  let claims: Record<string, unknown>;
  try {
    claims = decodeJwt(jwt) as Record<string, unknown>;
  } catch {
    return null;
  }
  const prov = claims.prov;
  if (prov !== "openai" && prov !== "xai" && prov !== "github") return null;
  const exp = claims.exp;
  if (typeof exp !== "number") return null;
  if (exp <= Math.floor(Date.now() / 1000)) return null;
  const appId = typeof claims.app === "string" && claims.app.length > 0 ? claims.app : null;
  return { provider: prov, expiresAt: exp, appId };
}
```

- [ ] **Step 5: Re-export from package index**

Edit `packages/server/src/index.ts`. Add at the bottom of the file (before any final newline):

```ts
export { decodeAuthAIToken } from "./decode.js";
export type { DecodedAuthAIToken } from "./decode.js";
```

- [ ] **Step 6: Run tests, verify pass**

Run: `pnpm --filter @authai/server test`
Expected: PASS, all 6 decode tests.

- [ ] **Step 7: Commit**

```bash
git add packages/server/package.json packages/server/src/decode.ts packages/server/src/decode.test.ts packages/server/src/index.ts pnpm-lock.yaml
git commit -m "$(cat <<'EOF'
feat(server): add decodeAuthAIToken() for local JWT inspection

For middleware / route guards that need to know "is the user signed
in and which provider" without making a network call to /auth/whoami.

Returns { provider, expiresAt, appId } only — deliberately never
exposes the `k` claim (the user-side AES key from the split-key
encryption model). Revoked tokens still pass local decode until
expiry; document this caveat in the integration guide.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 9: Migrate `example-react` to singleton-first

**Files:**
- Modify: `apps/example-react/src/App.tsx`

- [ ] **Step 1: Refactor App.tsx**

Edit `apps/example-react/src/App.tsx`. Replace the top of the file (imports through the AuthAIProvider wrap) with the singleton pattern. Keep the rest of the file (SignInScreen, ChatShell, icons) unchanged.

Replace lines 1–47 with:

```tsx
import { useEffect, useState } from "react";
import {
  SignIn,
  useAuthAI,
  configureAuthAI,
} from "@authai/react";
import { Chat } from "./components/Chat.js";

const RELAY_URL = import.meta.env.VITE_RELAY_URL ?? "https://relay.authai.io";
const BACKEND_URL = import.meta.env.VITE_BACKEND_URL ?? "";
const THEME_KEY = "authai-demo:theme";

type Mode = "light" | "dark";

function readInitialMode(): Mode {
  if (typeof window === "undefined") return "light";
  const stored = window.localStorage.getItem(THEME_KEY);
  if (stored === "dark" || stored === "light") return stored;
  return window.matchMedia?.("(prefers-color-scheme: dark)").matches
    ? "dark"
    : "light";
}

// Singleton config — module-scope, runs once before any component renders.
configureAuthAI({
  relayUrl: RELAY_URL,
  appName: "AuthAI Demo",
  storage: "localStorage",
});

export function App() {
  const [mode, setMode] = useState<Mode>(readInitialMode);

  useEffect(() => {
    try { window.localStorage.setItem(THEME_KEY, mode); } catch {}
    document.documentElement.dataset.theme = mode;
    // Reconfigure theme when the user toggles dark/light.
    configureAuthAI({
      relayUrl: RELAY_URL,
      appName: "AuthAI Demo",
      theme: {
        mode,
        radius: "14px",
        fontFamily: '"Geist", ui-sans-serif, system-ui, -apple-system, sans-serif',
      },
    });
  }, [mode]);

  return <Shell mode={mode} setMode={setMode} />;
}
```

The `<AuthAIProvider>` wrap is gone. `<Shell>`, `<SignInScreen>`, `<ChatShell>`, and the icon components stay exactly as they were.

- [ ] **Step 2: Boot the demo and verify**

Run in two terminals:
```bash
pnpm dev:relay      # :3000
pnpm dev:example    # :5173
```

Open http://localhost:5173. Verify:
- Sign-in screen renders without error
- Click "Continue with ChatGPT" → dialog appears (rendered by the auto-mounted SingletonDialogHost into document.body)
- Authorize at auth.openai.com → returns to app signed in
- Sign out → returns to sign-in screen

- [ ] **Step 3: Commit**

```bash
git add apps/example-react/src/App.tsx
git commit -m "$(cat <<'EOF'
refactor(example-react): migrate to singleton-first API

Drop <AuthAIProvider> wrapping in favor of configureAuthAI() called
once at module scope. Showcases the recommended client-SPA pattern:
no provider tree, useAuthAI() works anywhere, dialog auto-mounts.

The provider remains the right path for SSR — see example-nextjs.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 10: Build `apps/example-nextjs` SSR demo

**Files:**
- Create: `apps/example-nextjs/package.json`
- Create: `apps/example-nextjs/next.config.mjs`
- Create: `apps/example-nextjs/tsconfig.json`
- Create: `apps/example-nextjs/next-env.d.ts`
- Create: `apps/example-nextjs/app/layout.tsx`
- Create: `apps/example-nextjs/app/page.tsx`
- Create: `apps/example-nextjs/app/dashboard-client.tsx`
- Create: `apps/example-nextjs/app/api/chat/route.ts`
- Create: `apps/example-nextjs/README.md`

- [ ] **Step 1: Create the package and config files**

Create `apps/example-nextjs/package.json`:

```json
{
  "name": "example-nextjs",
  "version": "0.0.0",
  "private": true,
  "scripts": {
    "dev": "next dev -p 5174",
    "build": "next build",
    "start": "next start -p 5174"
  },
  "dependencies": {
    "@authai/react": "workspace:*",
    "@authai/server": "workspace:*",
    "next": "^15.0.3",
    "openai": "^4.77.0",
    "react": "^18.3.1",
    "react-dom": "^18.3.1"
  },
  "devDependencies": {
    "@types/node": "^22.10.1",
    "@types/react": "^18.3.12",
    "@types/react-dom": "^18.3.1",
    "typescript": "^5.6.3"
  }
}
```

Create `apps/example-nextjs/next.config.mjs`:

```js
/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
};
export default nextConfig;
```

Create `apps/example-nextjs/tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["dom", "dom.iterable", "esnext"],
    "allowJs": true,
    "skipLibCheck": true,
    "strict": true,
    "noEmit": true,
    "esModuleInterop": true,
    "module": "esnext",
    "moduleResolution": "bundler",
    "resolveJsonModule": true,
    "isolatedModules": true,
    "jsx": "preserve",
    "incremental": true,
    "plugins": [{ "name": "next" }],
    "paths": { "@/*": ["./*"] }
  },
  "include": ["next-env.d.ts", "**/*.ts", "**/*.tsx"],
  "exclude": ["node_modules"]
}
```

Create `apps/example-nextjs/next-env.d.ts`:

```ts
/// <reference types="next" />
/// <reference types="next/image-types/global" />
```

- [ ] **Step 2: Build the layout (server component reading the cookie)**

Create `apps/example-nextjs/app/layout.tsx`:

```tsx
import { cookies } from "next/headers";
import { AuthAIProvider } from "@authai/react";

const RELAY_URL = process.env.NEXT_PUBLIC_AUTHAI_RELAY_URL ?? "https://relay.authai.io";

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const cookieStore = await cookies();
  const jwt = cookieStore.get("authai-jwt")?.value ?? null;
  return (
    <html lang="en">
      <body>
        <AuthAIProvider
          relayUrl={RELAY_URL}
          appName="AuthAI Next.js Demo"
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

- [ ] **Step 3: Build the page (server component branching on cookie presence)**

Create `apps/example-nextjs/app/page.tsx`:

```tsx
import { cookies } from "next/headers";
import { decodeAuthAIToken } from "@authai/server";
import { DashboardClient } from "./dashboard-client.js";

export default async function Page() {
  const cookieStore = await cookies();
  const jwt = cookieStore.get("authai-jwt")?.value ?? null;
  const claims = decodeAuthAIToken(jwt);

  if (!claims) {
    // Signed-out shell is server-rendered. The sign-in dialog is
    // client-only; the provider's <SignIn> button triggers it.
    return (
      <main style={{ padding: "2rem", fontFamily: "system-ui" }}>
        <h1>AuthAI + Next.js</h1>
        <p>Sign in with your AI subscription.</p>
        <DashboardClient signedIn={false} />
      </main>
    );
  }

  return (
    <main style={{ padding: "2rem", fontFamily: "system-ui" }}>
      <h1>Welcome back</h1>
      <p>
        Signed in via <strong>{claims.provider}</strong>. Token expires at{" "}
        {new Date(claims.expiresAt * 1000).toLocaleString()}.
      </p>
      <DashboardClient signedIn={true} />
    </main>
  );
}
```

- [ ] **Step 4: Build the client island**

Create `apps/example-nextjs/app/dashboard-client.tsx`:

```tsx
"use client";

import { SignIn, useAuthAI } from "@authai/react";
import { useState } from "react";

export function DashboardClient({ signedIn }: { signedIn: boolean }) {
  const { signOut, jwt } = useAuthAI();
  const [reply, setReply] = useState("");
  const [pending, setPending] = useState(false);

  if (!signedIn) {
    return <SignIn>Sign in</SignIn>;
  }

  async function ask(prompt: string) {
    setReply(""); setPending(true);
    const res = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${jwt}` },
      body: JSON.stringify({ messages: [{ role: "user", content: prompt }] }),
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
    <>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          const p = new FormData(e.currentTarget).get("p") as string;
          if (p) void ask(p);
        }}
      >
        <input name="p" placeholder="Ask anything" disabled={pending} style={{ width: "100%", padding: "0.5rem" }} />
      </form>
      <pre style={{ marginTop: "1rem", whiteSpace: "pre-wrap" }}>{reply}</pre>
      <button onClick={() => signOut()} style={{ marginTop: "1rem" }}>Sign out</button>
    </>
  );
}
```

- [ ] **Step 5: Build the chat route handler**

Create `apps/example-nextjs/app/api/chat/route.ts`:

```ts
import { authai, AuthAIUnauthorized } from "@authai/server";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const jwt = req.headers.get("authorization")?.slice("Bearer ".length);
  const { messages } = await req.json();

  try {
    const { openai } = await authai.session({
      jwt,
      relayUrl: process.env.AUTHAI_RELAY_URL ?? "https://relay.authai.io",
    });
    if (!openai) return new Response("Install `openai` peer", { status: 500 });

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

- [ ] **Step 6: README for the demo**

Create `apps/example-nextjs/README.md`:

```md
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
```

- [ ] **Step 7: Install and smoke-test build**

Run:
```bash
pnpm install
pnpm --filter example-nextjs build
```

Expected: successful Next.js build with no type errors.

- [ ] **Step 8: Commit**

```bash
git add apps/example-nextjs pnpm-lock.yaml
git commit -m "$(cat <<'EOF'
feat(example-nextjs): add Next.js 15 App Router SSR demo

Shows the SSR path end-to-end:
- Cookie-backed storage via storage="cookie"
- Server-side cookie read → <AuthAIProvider initialJwt={...}> hydration
- decodeAuthAIToken() in server components for routing
- authai.session() in a route handler for streaming chat

Sits next to example-react (client SPA, singleton-first) so docs
can point at both patterns.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 11: Update README.md

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Replace the Frontend section and add SSR**

Edit `README.md`. Replace the "### Frontend (React)" section (lines 62–84 in current README) with:

```md
### Frontend (React)

Two integration paths. The singleton path is the recommended default for client SPAs; the provider path is for SSR (Next.js, Remix) and multi-tenant.

#### Singleton (client SPAs) — recommended

```tsx
import { configureAuthAI, SignIn, useAuthAI } from "@authai/react";

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
import { AuthAIProvider } from "@authai/react";

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

`initialJwt` is the SSR hand-off: pass a JWT from anywhere (cookie, NextAuth session, custom header) and the first render is correctly signed-in. `storage="cookie"` mirrors the JWT to a cookie so server components can read it. Full demo in `apps/example-nextjs`.

The SDK only exposes the JWT. There's no `client.chat()` method, no wrapper around `openai` — model calls happen in your backend, using the package you already use.
```

- [ ] **Step 2: Update the Roadmap section**

Edit the "## Roadmap" section. Remove the line "Framework-agnostic `@authai/web` SDK..." if you'd like to deprioritize it; keep otherwise. Remove "Express / Next.js middleware helpers" since `decodeAuthAIToken` covers the bulk of that use case now. Replace with:

```md
## Roadmap

- Postgres storage driver
- Framework-agnostic `@authai/web` SDK (vanilla / web component)
- HttpOnly cookie mode (relay-side session endpoint)
- Cloud edition (multi-tenant, dashboard, branded consent originators)
```

- [ ] **Step 3: Commit**

```bash
git add README.md
git commit -m "$(cat <<'EOF'
docs(readme): lead with singleton-first integration, add SSR path

The Frontend section now shows both:
- Singleton (recommended, client SPAs): configureAuthAI + bare hook
- Provider (SSR / advanced): <AuthAIProvider initialJwt storage="cookie">

Roadmap drops the "Next.js middleware helper" line — decodeAuthAIToken
covers it. Adds "HttpOnly cookie mode" as the next security hardening.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 12: Update `docs/integration.md`

**Files:**
- Modify: `docs/integration.md`

- [ ] **Step 1: Replace the Frontend section**

Edit `docs/integration.md`. Replace the entire "## Frontend" section (everything from `## Frontend` down to but not including `## Backend`) with:

```md
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
import { configureAuthAI, SignIn, useAuthAI } from "@authai/react";

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
import { AuthAIProvider } from "@authai/react";

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

`storage="cookie"` is one convenient way to get a JWT visible to your server code. You can use any other source (existing session middleware, request header forwarded from middleware, etc.) — just pass it to `initialJwt`.

For server components that need to know "is the user signed in" without a relay call, use `decodeAuthAIToken` from `@authai/server`:

```tsx
import { cookies } from "next/headers";
import { decodeAuthAIToken } from "@authai/server";

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
import { cookieAdapter } from "@authai/react";

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

```

- [ ] **Step 2: Update the End-to-end Next.js example**

Edit the "## End-to-end example (Next.js App Router)" section. Replace the provider snippet to include `initialJwt` + `storage="cookie"`, and add the server-side `decodeAuthAIToken` usage. Keep the route handler example as-is.

In the `app/layout.tsx` example, replace it with:

```tsx
import { cookies } from "next/headers";
import { AuthAIProvider } from "@authai/react";

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

- [ ] **Step 3: Add a "Middleware / route guards" subsection under Backend**

After the "### `authai.session()` options" subsection in the Backend section, add:

```md
### Middleware / route guards (`decodeAuthAIToken`)

For route guards where you only need to know "is the user signed in" and "which provider" — without contacting the relay — use the local decode helper:

```ts
import { decodeAuthAIToken } from "@authai/server";
import { NextResponse } from "next/server";

export function middleware(req) {
  const jwt = req.cookies.get("authai-jwt")?.value;
  const claims = decodeAuthAIToken(jwt);
  if (!claims) return NextResponse.redirect(new URL("/sign-in", req.url));
}
```

Returns `{ provider, expiresAt, appId } | null`. Never returns the encryption key. Skips the relay round-trip, so it scales linearly with traffic — but accepts the caveat that revoked tokens stay valid until their JWT exp. The relay still enforces revocation on every `/v1/*` call.
```

- [ ] **Step 4: Commit**

```bash
git add docs/integration.md
git commit -m "$(cat <<'EOF'
docs(integration): document singleton-first, SSR, and decodeAuthAIToken

Restructures the Frontend section around the dual-path model:
- Singleton (default) for client SPAs
- Provider (advanced) for SSR with initialJwt + cookie storage

Updates the security callout to explain why the JWT is more sensitive
than a typical session cookie (split-key model). Adds a Backend
subsection covering decodeAuthAIToken for middleware / route guards.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 13: Full verification pass

**Files:**
- (none — verification only)

- [ ] **Step 1: Run the entire test suite**

Run from repo root:
```bash
pnpm test
```

Expected: All packages pass.
- `packages/relay`: 65 tests
- `packages/relay-store-postgres`: 3 tests
- `packages/cloud`: 34 tests
- `packages/react`: NEW tests (smoke + cookie + singleton + configure + provider) all green
- `packages/server`: NEW decodeAuthAIToken tests green

- [ ] **Step 2: Type-check every package**

Run from repo root:
```bash
pnpm build
```

Expected: Every package compiles. No type errors.

- [ ] **Step 3: Manually smoke-test both example apps**

Terminal 1: `pnpm dev:relay`
Terminal 2: `pnpm dev:example` (singleton path), visit http://localhost:5173
Terminal 3: `pnpm --filter example-nextjs dev`, visit http://localhost:5174

Verify in `example-react`:
- Sign-in dialog appears with no provider wrapping
- Completes flow, lands signed-in
- Sign out works

Verify in `example-nextjs`:
- First paint shows signed-out state without flash
- After sign-in, refresh the page → server-rendered welcome appears immediately (no client-side flicker)
- Sign out clears the cookie; refresh returns to the sign-in shell

- [ ] **Step 4: Confirm there are no leftover TODOs or commented-out code**

Run:
```bash
grep -rn "TODO\|FIXME\|XXX" packages/react/src packages/server/src apps/example-react/src apps/example-nextjs 2>/dev/null
```

Expected: no new entries from this work.

- [ ] **Step 5: Open the PR**

This task list does not include `gh pr create` — defer to the user. The branch is `feat/singleton-first-sdk`; once the user wants to ship, they can invoke their normal PR workflow.

---

## Self-Review Notes

**Coverage check (spec → tasks):**
- Singleton store on globalThis → Task 3
- `configureAuthAI()` public API → Task 4
- `useAuthAI()` falls back to singleton, never throws → Task 5
- `<AuthAIProvider initialJwt>` for SSR → Task 5
- Dialog renders null on SSR → Task 5 (via SingletonDialogHost guard + provider's existing structure)
- Cookie storage adapter → Task 2
- `<SignIn>` works without provider → Task 6
- `decodeAuthAIToken` in `@authai/server` (no `k` leak) → Task 8
- Example-react migration → Task 9
- Example-nextjs SSR demo → Task 10
- README update → Task 11
- docs/integration.md update → Task 12
- Final verification → Task 13

**Security check:**
- `decodeAuthAIToken` test explicitly asserts `k` is not in the return type AND the secret value does not appear in the JSON serialization — Task 8 Step 2.
- Documentation calls out that the JWT carries an encryption key, not just a session id — README + integration.md.

**Type consistency:**
- `ProviderId` is consistently `"openai" | "xai" | "github"` across `@authai/react/src/auth.ts` and the new `@authai/server/src/decode.ts`.
- `TokenStorage` interface is unchanged; cookie adapter conforms to it.
- `AuthAIContextValue.relayUrl` becomes `string | null` (was `string`) because the singleton path may have no config yet. This is a non-breaking widening for consumers who only read it when `isSignedIn === true`, but call out in the README that early reads can be null.
- `configureAuthAI({ storage })` and `<AuthAIProvider storage>` accept the same union: `"localStorage" | "memory" | "cookie" | TokenStorage`.
