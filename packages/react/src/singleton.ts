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
  if (!isBrowser()) return;
  const store = getStore();
  store.config.relayUrl = opts.relayUrl;
  store.config.appName = opts.appName;
  if (opts.theme !== undefined) store.config.theme = opts.theme;
  if (opts.storage !== undefined && store.state.jwt === null) {
    store.config.storageSpec = opts.storage;
    store.storage = null;
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
  if (!provider) {
    if (!store.config.relayUrl || !store.config.appName) {
      // No provider given and no config — surface error state instead of throwing,
      // so the dialog can render the error. The error message names the missing
      // config so callers see it.
      store.state = {
        ...store.state,
        phase: "error",
        error: "AuthAI: call configureAuthAI({ relayUrl, appName }) before signIn()",
      };
      emit(store);
      return;
    }
    store.state = { ...store.state, phase: "picker", error: null };
    emit(store);
    return;
  }
  if (!store.config.relayUrl) {
    throw new Error("AuthAI: call configureAuthAI({ relayUrl, appName }) before signIn()");
  }
  if (!store.config.appName) {
    throw new Error("AuthAI: configureAuthAI({ appName }) is required before signIn()");
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
    store.abort = null;
  } catch (err) {
    if ((err as Error).name === "AbortError") {
      store.abort = null;
      return;
    }
    store.state = {
      ...store.state,
      pendingProvider: null,
      verification: null,
      phase: "error",
      error: (err as Error).message,
    };
    emit(store);
    store.abort = null;
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
  store.abort = null;
}

/** Test-only: wipe singleton state. Not exported from package index. */
export function resetSingletonForTests(): void {
  const g = globalThis as any;
  delete g[KEY];
}
