/**
 * CSRF tokens for cloud-web server actions.
 *
 * Token shape: signed JWT (HS256, AUTH_AI_CLOUD_WEB_CSRF_SECRET) carrying:
 *   - sid:   SHA-256 hash of the session cookie value (binds to logged-in session)
 *   - act:   canonical action name, e.g. "apps.create" / "origins.add"
 *   - exp:   unix seconds; default 1 hour from issuance
 *   - nonce: 16 random bytes base64url; one-shot, tracked in an in-process Map
 *
 * Verification rejects on signature failure, expiry, sid mismatch, act
 * mismatch, or reused nonce.
 */

import { SignJWT, jwtVerify } from "jose";
import { createHash, randomBytes } from "node:crypto";
import { CSRF_SECRET_HEX } from "./env.js";

const LIFETIME_SECONDS = 60 * 60;
const NONCE_TTL_MS = (LIFETIME_SECONDS + 60) * 1000;

const consumedNonces = new Map<string, number>();

function pruneOldNonces(): void {
  const cutoff = Date.now() - NONCE_TTL_MS;
  for (const [n, t] of consumedNonces) if (t < cutoff) consumedNonces.delete(n);
}

function secretKey(): Uint8Array {
  // Validate at first use rather than at module import — Next.js build's
  // "Collecting page data" runs route modules without runtime env vars,
  // so import-time validation would break Dockerfile builds.
  if (CSRF_SECRET_HEX.length < 64) {
    if (process.env.NODE_ENV === "production") {
      throw new Error(
        "AUTH_AI_CLOUD_WEB_CSRF_SECRET must be at least 64 hex chars (32 bytes)",
      );
    }
    // Dev/test fallback: deterministic non-secret value so tests work.
    return new Uint8Array(Buffer.from("0".repeat(64), "hex"));
  }
  return new Uint8Array(Buffer.from(CSRF_SECRET_HEX, "hex"));
}

function sessionDigest(sessionCookieValue: string): string {
  return createHash("sha256").update(sessionCookieValue, "utf8").digest("hex");
}

export async function issueCsrfToken(opts: {
  sessionCookieValue: string;
  action: string;
}): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const nonce = randomBytes(16).toString("base64url");
  return await new SignJWT({
    sid: sessionDigest(opts.sessionCookieValue),
    act: opts.action,
    nonce,
  })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt(now)
    .setExpirationTime(now + LIFETIME_SECONDS)
    .sign(secretKey());
}

export async function verifyCsrf(opts: {
  token: string;
  sessionCookieValue: string;
  action: string;
}): Promise<boolean> {
  pruneOldNonces();
  try {
    const { payload } = await jwtVerify(opts.token, secretKey(), { algorithms: ["HS256"] });
    if (payload.sid !== sessionDigest(opts.sessionCookieValue)) return false;
    if (payload.act !== opts.action) return false;
    const nonce = String(payload.nonce);
    if (consumedNonces.has(nonce)) return false;
    consumedNonces.set(nonce, Date.now());
    return true;
  } catch {
    return false;
  }
}

/** Test-only: clear consumed nonces between tests. */
export function __resetCsrfStateForTests(): void {
  consumedNonces.clear();
}
