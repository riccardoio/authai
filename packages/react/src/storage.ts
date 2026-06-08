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
