import { configureSingleton } from "./singleton.js";
import type { TokenStorage } from "./storage.js";
import type { AuthAITheme } from "./dialog/theme.js";

export type ConfigureAuthAIOptions = {
  relayUrl: string;
  appName: string;
  theme?: AuthAITheme;
  storage?: "localStorage" | "memory" | "cookie" | TokenStorage;
  /**
   * Publishable key (authai_pk_...) for the prototype/browser-direct path.
   * When set, the SDK sends x-authai-publishable-key on /auth/* and /v1/*
   * calls. The publishable key is browser-safe; origin-pinned at the relay.
   * For production apps, prefer backend-proxied AUTH_AI_SECRET via
   * @authai/server's authai.session().
   */
  appId?: string;
};

const CLOUD_RELAY_URL = "https://relay.authai.io";
let warned = false;

function maybeWarnBrowserDirect(opts: ConfigureAuthAIOptions): void {
  if (warned) return;
  if (!opts.appId) return;
  if (opts.relayUrl !== CLOUD_RELAY_URL) return;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const env = typeof (globalThis as any).process !== "undefined"
    ? (globalThis as any).process?.env?.NODE_ENV
    : undefined;
  if (env === "production") return;
  // eslint-disable-next-line no-console
  console.warn(
    "AuthAI: Running in browser-direct mode against the production relay. " +
    "This is supported for prototypes. For production apps, proxy through " +
    "a backend with AUTH_AI_SECRET — see https://authai.io/docs/integration#production"
  );
  warned = true;
}

/**
 * Configure the AuthAI singleton. Call once at module scope before any
 * <SignIn> or useAuthAI().signIn() call. No-op on the server.
 *
 * Apps using <AuthAIProvider> do NOT need to call this — the provider
 * supplies its own config. Mixing both paths is allowed but each store
 * is independent (the provider wins in its subtree).
 */
export function configureAuthAI(options: ConfigureAuthAIOptions): void {
  maybeWarnBrowserDirect(options);
  configureSingleton(options);
}

/** Test-only — not exported from the package index. */
export function __resetConfigureWarnedForTests(): void {
  warned = false;
}
