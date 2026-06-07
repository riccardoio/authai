import type { Context } from "hono";

/**
 * A Tenant is the per-request identity context the relay uses to encrypt
 * tokens, hash account IDs, and brand the OAuth consent screen.
 *
 * - Community edition: a single static tenant constructed once at boot from
 *   AUTH_AI_ORIGINATOR + AUTH_AI_IDENTITY_SECRET env vars. `appId` is
 *   undefined; JWTs omit the `app_id` claim.
 * - Cloud edition: the tenant is resolved per-request from an `apps` table
 *   row keyed by the request's Origin header or x-authai-key header. `appId`
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
};

/**
 * Resolver pulled per-request. Returning `null` means "no tenant for this
 * request" — the relay treats that as a uniform 401 in cloud edition. In
 * community edition the StaticTenantResolver always returns the same
 * Tenant, so null never happens.
 */
export interface TenantResolver {
  resolve(c: Context): Promise<Tenant | null>;
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
 */
export function tenantMiddleware(resolver: TenantResolver) {
  return async (c: Context, next: () => Promise<void>) => {
    // OPTIONS preflights are handled by the CORS middleware before we run;
    // if one slips through, skip tenant resolution so we don't 401 a
    // preflight.
    if (c.req.method === "OPTIONS") {
      return next();
    }
    const tenant = await resolver.resolve(c);
    if (!tenant) {
      // Match the uniform-401 contract used by /auth/whoami and /v1/*.
      return c.json({ error: "unauthorized" }, 401);
    }
    c.set("tenant", tenant);
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
