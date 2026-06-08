import { hkdfSync, createHash, randomBytes } from "node:crypto";
import { PREVIEW_HOST_SUFFIXES } from "./preview-allowlist.js";

/**
 * Derive a 32-byte per-app identitySecret from a single master secret + appId.
 *
 *   identitySecret = HKDF-SHA256(masterSecret, salt='', info='authai-cloud-identity:' + appId)
 *
 * Properties:
 *   - Same input → deterministic output. Looking up an app's secret only
 *     needs the master + appId; no per-app secret is persisted.
 *   - Different appIds → uncorrelated outputs (HKDF property).
 *   - Master secret never leaves the relay process; rotation invalidates
 *     every app's user.id mapping (documented elsewhere as an identity
 *     reset, not an operational rotation).
 *
 *   The per-app identitySecret is then used by @authai/relay's existing
 *   identityId(secret, provider, accountId) HMAC. Two apps with the same
 *   upstream ChatGPT user see different user.id values.
 */
export function derivePerAppIdentitySecret(
  masterSecret: Buffer,
  appId: string,
): Buffer {
  if (masterSecret.length < 32) {
    throw new Error("master secret must be at least 32 bytes");
  }
  const info = Buffer.from(`authai-cloud-identity:${appId}`, "utf8");
  const out = hkdfSync("sha256", masterSecret, Buffer.alloc(0), info, 32);
  return Buffer.from(out);
}

/**
 * Hash an API key for storage. We never persist the raw key — the relay
 * stores SHA-256(key), looks up apps by hashed key on incoming requests,
 * and uses a constant-time comparison via the unique index hit.
 *
 * The key itself is ~32 bytes of random URL-safe data; brute-forcing the
 * preimage is computationally infeasible. SHA-256 (not bcrypt/argon2) is
 * the right choice because the keys are high-entropy random — slow hashes
 * defend low-entropy human passwords, which API keys are not.
 */
export function hashApiKey(key: string): string {
  return createHash("sha256").update(key, "utf8").digest("hex");
}

/**
 * Generate a new API key. Returned to the builder once at app creation
 * time. The relay only ever stores the hash.
 *
 * Format: `authai_v1_` + 32 bytes of base64url. Prefix makes leaked keys
 * easy to scan for in logs or git history.
 */
export function generateApiKey(): string {
  return `authai_v1_${randomBytes(32).toString("base64url")}`;
}

/**
 * Generate the DNS TXT verification token for an app. Used by v2's
 * consent-dialog verification flow. v1 doesn't call this — every app's
 * `originVerifyToken` column is empty. Kept exported for the v2 PR.
 */
export function generateVerifyToken(): string {
  return randomBytes(16).toString("hex");
}

/**
 * Normalize a user-supplied origin string to its canonical form: scheme
 * + host (+ explicit non-default port). Returns `null` if the input is
 * not a valid http(s) URL.
 *
 *   normalizeOrigin("https://example.com/")     → "https://example.com"
 *   normalizeOrigin("HTTPS://Example.com")      → "https://example.com"
 *   normalizeOrigin("https://example.com:443/") → "https://example.com"
 *   normalizeOrigin("http://localhost:3000/x")  → null  (path present)
 *   normalizeOrigin("ftp://example.com")        → null  (wrong scheme)
 *
 * This is the single source of truth for origin shape across the cloud
 * edition: the webapp uses it at registration time and the
 * CloudTenantResolver uses it on every request lookup, so a builder
 * pasting `https://example.com/` and a browser sending
 * `Origin: https://example.com` resolve to the same row.
 */
export function normalizeOrigin(raw: string): string {
  if (!raw || raw === "null") return "";
  try {
    const url = new URL(raw);
    if (url.protocol !== "http:" && url.protocol !== "https:") return "";
    // Origin must NOT carry a path, query, or fragment.
    if (url.pathname !== "/" && url.pathname !== "") return "";
    if (url.search || url.hash) return "";
    // Construct origin: scheme://host[:port], no trailing slash.
    return `${url.protocol}//${url.host}`.toLowerCase();
  } catch {
    return "";
  }
}

/**
 * Generate a new browser-safe publishable key. Returned to the developer
 * ONCE at app creation; the relay only stores the hash. Origin-pinned at
 * the relay — useless from a non-registered origin (browser-side) and
 * abuse-controlled via rate limits + dashboard signals (server-side
 * spoof).
 *
 * Format: `authai_pk_` + 32 bytes of base64url. Prefix lets leak scanners
 * and engineers tell publishable keys apart from `AUTH_AI_SECRET`
 * (`authai_v1_*`) at a glance.
 */
export function generatePublishableKey(): string {
  return `authai_pk_${randomBytes(32).toString("base64url")}`;
}

/**
 * Classify an Origin string into a tier used for rate-limit policy.
 *
 *   - localhost: dev-only; very strict per-IP limits
 *   - preview:   curated allowlist of preview platforms (lovable.app, v0.dev, etc.)
 *   - production: everything else; standard cloud-edition limits
 *
 * Tier is informational in v1 — no DNS verification — but determines
 * which rate-limit bucket applies in @authai/cloud's kill-switch.
 */
export type OriginTier = "localhost" | "preview" | "production";

export function classifyOriginTier(origin: string): OriginTier {
  let url: URL;
  try {
    url = new URL(origin);
  } catch {
    return "production"; // upstream validation rejects unparseable
  }
  const host = url.hostname;
  if (host === "localhost" || host === "127.0.0.1" || host.endsWith(".local")) {
    return "localhost";
  }
  for (const suffix of PREVIEW_HOST_SUFFIXES) {
    if (host === suffix || host.endsWith(`.${suffix}`)) {
      return "preview";
    }
  }
  return "production";
}
