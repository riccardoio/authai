import type { Context } from "hono";

/**
 * How the tenant was resolved on this request. Middleware uses this to
 * apply route-aware policy (e.g. publishable keys may only reach /auth/*,
 * not /v1/*).
 */
export type CredentialResolutionMethod = "secret" | "publishable" | "origin";

/**
 * A Tenant is the per-request identity context the relay uses to encrypt
 * tokens, hash account IDs, and brand the OAuth consent screen.
 *
 * - Community edition: a single static tenant constructed once at boot from
 *   AUTH_AI_ORIGINATOR + AUTH_AI_IDENTITY_SECRET env vars. `appId` is
 *   undefined; JWTs omit the `app_id` claim.
 * - Cloud edition: the tenant is resolved per-request from an `apps` table
 *   row keyed by the request's Origin header or x-authai-secret header. `appId`
 *   is always set; JWTs MUST carry a matching `app_id` claim or the relay
 *   returns uniform 401.
 *
 * Routes never reach into env vars or app rows themselves. They read
 * `c.get('tenant')` after the tenant middleware has run.
 */
export type Tenant = {
  /**
   * The brand the upstream provider shows on the consent screen during
   * device-code sign-in. Carried through to subsequent token refreshes via
   * the encrypted record so a relay rotation doesn't suddenly rebrand the
   * provider screen.
   */
  originator: string;

  /**
   * 32-byte HMAC key used to derive opaque, namespaced user IDs:
   *
   *     user.id = HMAC-SHA256(identitySecret, provider || \0 || accountId)
   *
   * In cloud edition this is HKDF-derived from a master secret + appId so
   * different apps see different `user.id` for the same provider account —
   * preserving cross-app privacy by default.
   */
  identitySecret: Buffer;

  /**
   * Cloud-edition only. Identifies which app's tenant this request belongs
   * to. Must match the `app_id` claim on any JWT presented at `/v1/*` or
   * `/auth/whoami`. Always undefined in community edition.
   */
  appId?: string;

  /**
   * How the tenant was resolved. Middleware uses this for route-aware
   * enforcement (e.g. publishable keys are restricted to /auth/* routes).
   * Optional to keep community-edition StaticTenantResolver compatible.
   */
  resolvedVia?: CredentialResolutionMethod;

  /**
   * Mirror of apps.credential_type. Middleware uses this for /auth/* policy
   * decisions. Optional in community edition.
   */
  credentialType?: "secret" | "publishable";

  /**
   * Mirror of apps.browser_direct_enabled. Relay returns 401 for publishable
   * key requests when this is false. Optional in community edition.
   */
  browserDirectEnabled?: boolean;
};

/**
 * Resolver pulled per-request. Returning `null` means "no tenant for this
 * request" — the relay treats that as a uniform 401 in cloud edition. In
 * community edition the StaticTenantResolver always returns the same
 * Tenant, so null never happens. Returning `"BOTH_HEADERS"` means both
 * secret and publishable-key headers were present — middleware emits a
 * 400 conflicting_credentials response.
 */
export interface TenantResolver {
  resolve(c: Context): Promise<Tenant | null | "BOTH_HEADERS">;
}

/**
 * Community-edition resolver. Captures originator + identitySecret at boot
 * and returns the same Tenant for every request, regardless of Origin or
 * any other request property. Self-hosted single-tenant deploys use this.
 */
export class StaticTenantResolver implements TenantResolver {
  private readonly tenant: Tenant;

  constructor(params: { originator: string; identitySecret: Buffer }) {
    this.tenant = {
      originator: params.originator,
      identitySecret: params.identitySecret,
    };
  }

  async resolve(_c: Context): Promise<Tenant> {
    return this.tenant;
  }
}

/**
 * Hono middleware that runs the resolver once per request and pins the
 * Tenant onto context. Downstream handlers read it via `c.get('tenant')`.
 *
 * Cloud resolvers may return null (e.g. unknown Origin); the middleware
 * surfaces that as a uniform 401 so /auth/* and /v1/* share a single
 * authentication-failure shape (no oracle).
 *
 * Idempotent: if a deploy-app middleware already resolved the tenant and
 * set it on context (e.g., the cloud relay's per-app rate limiter needs
 * the tenant earlier in the chain), this middleware sees the existing
 * value and skips its own DB lookup. Avoids resolving twice per request.
 */
export function tenantMiddleware(resolver: TenantResolver) {
  return async (c: Context, next: () => Promise<void>) => {
    // OPTIONS preflights are handled by the CORS middleware before we run;
    // if one slips through, skip tenant resolution so we don't 401 a
    // preflight.
    if (c.req.method === "OPTIONS") {
      return next();
    }
    // Hono's ContextVariableMap has `tenant` typed as required (the
    // module augmentation below) but `c.get` may legitimately return
    // undefined when the key was never set. Cast through unknown so we
    // can check without TS narrowing screaming about a always-truthy
    // expression.
    const existing = (c.get("tenant") as unknown) as Tenant | undefined;
    if (existing) return next();
    const tenant = await resolver.resolve(c);
    if (tenant === "BOTH_HEADERS") {
      return c.json({ error: "conflicting_credentials" }, 400);
    }
    if (!tenant) {
      // Match the uniform-401 contract used by /auth/whoami and /v1/*.
      return c.json({ error: "unauthorized" }, 401);
    }
    c.set("tenant", tenant);

    // Route-aware enforcement. Only applies when resolvedVia is explicitly
    // set (cloud edition). When it's undefined (StaticTenantResolver /
    // community edition) both gates are skipped — backward compat preserved.
    if (tenant.resolvedVia !== undefined) {
      const path = c.req.path;

      // /v1/* may NEVER be reached via Origin-only resolution.
      // Explicit credential header (secret or publishable key) is required.
      // Closes the Codex P0-1 tenant-bypass surface.
      if (path.startsWith("/v1/") && tenant.resolvedVia === "origin") {
        return c.json({ error: "credential_required" }, 401);
      }

      // /auth/* on publishable apps requires explicit publishable-key header.
      // Prevents per-key rate-limit bypass via Origin spoofing.
      if (
        path.startsWith("/auth/") &&
        tenant.credentialType === "publishable" &&
        tenant.resolvedVia === "origin"
      ) {
        return c.json({ error: "credential_required" }, 401);
      }
    }

    return next();
  };
}

/**
 * Module augmentation so `c.get('tenant')` is typed without per-route
 * generic ceremony. Hono picks this up at compile time when this module
 * is imported anywhere in the relay package.
 */
declare module "hono" {
  interface ContextVariableMap {
    tenant: Tenant;
  }
}
