import { hkdfSync, createHash, randomBytes } from "node:crypto";

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
 * Generate the DNS TXT verification token for an app. Stored on the apps
 * row at creation; the builder publishes a TXT record `authai-verify=<token>`
 * on their origin to prove control before unverified-bucket rate limits
 * lift.
 */
export function generateVerifyToken(): string {
  return randomBytes(16).toString("hex");
}
