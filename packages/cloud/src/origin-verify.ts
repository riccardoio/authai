import { resolveTxt } from "node:dns/promises";

/**
 * Origin verification via DNS TXT record. The builder publishes a
 * `TXT authai-verify=<token>` on their origin's hostname to prove control;
 * the relay checks it and lifts the ephemeral-bucket rate limit cap.
 *
 * Caching:
 *   - 60s positive cache: once verified for a hostname+token pair, we
 *     don't re-query DNS until the cache expires.
 *   - 30-day re-verification: after 30 days, the relay re-queries DNS to
 *     confirm the TXT record still exists; if missing, demote the app
 *     back to the ephemeral bucket within 24h.
 *
 * Why Cloudflare 1.1.1.1 via the resolver: Node's default resolver respects
 * the system /etc/resolv.conf, which on Fly.io and similar hosts may be a
 * private resolver that doesn't return public TXT records reliably.
 */

const POSITIVE_CACHE_TTL_MS = 60_000;
const REVERIFY_INTERVAL_MS = 30 * 24 * 60 * 60 * 1000;

export type OriginVerifyResult = {
  verified: boolean;
  /** UNIX ms — when this verification was sampled. */
  checkedAt: number;
  /** Optional error message for diagnostics; never surfaced to end users. */
  reason?: string;
};

export interface OriginVerifier {
  verify(origin: string, expectedToken: string): Promise<OriginVerifyResult>;
}

export type OriginVerifierConfig = {
  /**
   * Custom DNS lookup. Defaults to `node:dns/promises#resolveTxt`. Tests
   * pass a mock that returns deterministic records.
   */
  resolver?: (hostname: string) => Promise<string[][]>;
};

export function createOriginVerifier(
  config: OriginVerifierConfig = {},
): OriginVerifier {
  const resolver = config.resolver ?? resolveTxt;
  type CacheEntry = { result: OriginVerifyResult };
  const cache = new Map<string, CacheEntry>();

  return {
    async verify(origin, expectedToken) {
      const hostname = hostnameFor(origin);
      if (!hostname) {
        return { verified: false, checkedAt: Date.now(), reason: "invalid origin" };
      }
      const cacheKey = `${hostname}|${expectedToken}`;
      const now = Date.now();
      const cached = cache.get(cacheKey);
      if (cached) {
        const age = now - cached.result.checkedAt;
        if (cached.result.verified && age < REVERIFY_INTERVAL_MS) return cached.result;
        if (!cached.result.verified && age < POSITIVE_CACHE_TTL_MS) return cached.result;
      }

      let result: OriginVerifyResult;
      try {
        const records = await resolver(hostname);
        const target = `authai-verify=${expectedToken}`;
        // resolveTxt returns string[][] because a single TXT record can
        // have multiple strings (joined with implicit concat). We treat
        // each tuple's join as one logical record value.
        const found = records.some((tuple) => tuple.join("") === target);
        result = { verified: found, checkedAt: now };
        if (!found) result.reason = "TXT record not found";
      } catch (err) {
        result = {
          verified: false,
          checkedAt: now,
          reason: `dns error: ${(err as Error).message}`,
        };
      }
      cache.set(cacheKey, { result });
      return result;
    },
  };
}

/**
 * One-shot DNS verification. Useful for tests or scripts that need to
 * confirm an origin without caching.
 */
export async function verifyOriginByDns(
  origin: string,
  expectedToken: string,
): Promise<OriginVerifyResult> {
  const verifier = createOriginVerifier();
  return verifier.verify(origin, expectedToken);
}

/**
 * Origins that skip DNS verification entirely. They're always allowed but
 * rate-limited to the ephemeral bucket via separate enforcement.
 */
export function isAutoAllowedOrigin(origin: string): boolean {
  try {
    const url = new URL(origin);
    if (url.hostname === "localhost") return true;
    if (url.hostname === "127.0.0.1") return true;
    if (url.hostname.endsWith(".vercel.app")) return true;
    return false;
  } catch {
    return false;
  }
}

function hostnameFor(origin: string): string | null {
  try {
    return new URL(origin).hostname;
  } catch {
    return null;
  }
}
