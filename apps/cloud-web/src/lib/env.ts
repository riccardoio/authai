/**
 * Env var resolution + validation. All "required" vars are loud-fail at
 * import time so a misconfigured deployment surfaces immediately, not at
 * the first authenticated request.
 */

export function required(name: string): string {
  const v = process.env[name];
  if (!v || v.length === 0) {
    throw new Error(`[cloud-web] missing required env var: ${name}`);
  }
  return v;
}

/**
 * First non-empty value among the given env vars. Used so
 * AUTH_AI_DATABASE_URL coexists with Dokku's auto-injected DATABASE_URL
 * (postgres:link sets the latter; we read either so a credential
 * rotation doesn't require manually re-mirroring vars).
 */
export function requiredFromAny(names: string[]): string {
  for (const name of names) {
    const v = process.env[name];
    if (v && v.length > 0) return v;
  }
  throw new Error(
    `[cloud-web] missing required env var; tried: ${names.join(", ")}`,
  );
}

export function optional(name: string, fallback: string): string {
  return process.env[name] ?? fallback;
}

export const RELAY_URL = optional("AUTH_AI_CLOUD_RELAY_URL", "https://relay.authai.io");
export const WEBAPP_URL = optional("AUTH_AI_CLOUD_WEB_URL", "https://authai.io");

// Webapp-side GitHub OAuth client. SEPARATE from the relay's identity —
// this app uses the web OAuth flow (client secret + redirect), the relay
// has no GitHub dependency at all in the cloud edition.
export const GITHUB_CLIENT_ID = process.env.GITHUB_CLIENT_ID ?? "";
export const GITHUB_CLIENT_SECRET = process.env.GITHUB_CLIENT_SECRET ?? "";

// Cookie + CLI-bridge session signer. Reused for all webapp-issued
// short-lived tokens. NEVER the same as the relay's JWT secret.
export const SESSION_SECRET_HEX = process.env.AUTH_AI_CLOUD_WEB_SESSION_SECRET ?? "";
