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
