/**
 * @authai/cloud — the cloud edition's runtime add-ons for the AuthAI relay.
 *
 * The community edition (single-tenant, self-hosted) does not need this
 * package at all — `@authai/relay` + `@authai/relay-store-sqlite` is
 * complete on its own.
 *
 * The cloud edition wires:
 *   - CloudTenantResolver (per-request tenant lookup by Origin or
 *     x-authai-key header)
 *   - HKDF-derived per-app identitySecret
 *   - Admin API (POST/GET/DELETE /admin/apps) with GitHub-OAuth auth
 *   - Audit log writes for app lifecycle events
 *
 * Lane C adds origin verification + rate limits + kill switch.
 *
 * LICENSE: BSL-1.1-style source-available. See packages/cloud/LICENSE.
 */

export { CloudTenantResolver, createMemoryCache } from "./tenant.js";
export type { CloudTenantConfig, TenantCache } from "./tenant.js";

export {
  derivePerAppIdentitySecret,
  hashApiKey,
  generateApiKey,
  generateVerifyToken,
} from "./identity.js";

export {
  issueAdminJwt,
  verifyAdminJwt,
  fetchGithubUser,
} from "./admin-auth.js";

export { createAdminRoutes } from "./admin-routes.js";
export type { AdminRoutesConfig } from "./admin-routes.js";

export {
  verifyOriginByDns,
  createOriginVerifier,
  isAutoAllowedOrigin,
} from "./origin-verify.js";
export type { OriginVerifier, OriginVerifierConfig } from "./origin-verify.js";

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
