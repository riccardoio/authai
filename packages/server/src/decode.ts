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
