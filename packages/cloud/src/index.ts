/**
 * @authai/cloud — cloud-edition runtime add-ons for the AuthAI relay.
 *
 * The cloud edition's relay is pure data-plane: it accepts encrypted-token
 * reads/writes, runs the OAuth device-code flow, and proxies model calls.
 * App registration, the dashboard, and builder identity all live in a
 * separate webapp (`apps/cloud-web`, deployed to Vercel at
 * `cloud.authai.dev`). This package provides ONLY the relay-side
 * primitives the webapp doesn't:
 *
 *   - CloudTenantResolver (per-request tenant lookup by Origin or
 *     x-authai-key header)
 *   - HKDF per-app identitySecret derivation
 *   - Kill switch state machine + per-app rate limiter
 *   - DNS TXT origin verification
 *   - Edition gate
 *
 * The webapp talks to the same Postgres `apps` table the relay reads.
 * They share data, not code paths.
 */

export { CloudTenantResolver } from "./tenant.js";
export type { CloudTenantConfig } from "./tenant.js";

export {
  derivePerAppIdentitySecret,
  hashApiKey,
  generateApiKey,
  generateVerifyToken,
  normalizeOrigin,
} from "./identity.js";

// DNS TXT origin verification (packages/cloud/src/origin-verify.ts) is NOT
// exported in v1. The v1 cloud edition treats every registered origin as
// usable — the upstream provider's consent screen identifies "AuthAI Cloud"
// generically and not the builder's origin, so origin spoofing doesn't
// confuse end users in v1. v2's consent dialog (per-app budget caps shown
// to the end user) reactivates the verification gate; until then the
// file stays in the package but unwired. Existing consumers should rely
// on per-app rate limits + the global cost-cap kill switch for abuse
// mitigation.

export {
  createKillSwitch,
  createRateLimiter,
} from "./kill-switch.js";
export type {
  KillSwitch,
  KillSwitchState,
  KillSwitchEvent,
  RateLimiter,
  RateLimitDecision,
  RateLimiterConfig,
  KillSwitchConfig,
  RedisLike,
} from "./kill-switch.js";

export { resolveEdition } from "./edition.js";
export type { Edition } from "./edition.js";
