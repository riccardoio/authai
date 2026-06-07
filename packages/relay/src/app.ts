import { Hono, type MiddlewareHandler } from "hono";
import { timingSafeEqual } from "node:crypto";
import { createAuthRoutes } from "./auth-routes.js";
import { createV1Routes } from "./v1-routes.js";
import type { AuthRecordStore } from "./store.js";
import {
  StaticTenantResolver,
  tenantMiddleware,
  type TenantResolver,
} from "./tenant.js";

/**
 * Two shapes are accepted for backward compatibility.
 *
 * Community (legacy, single-tenant):
 *   { store, jwtSecret, identitySecret, originator }
 *
 * Cloud or any caller that wants per-request tenant resolution:
 *   { store, jwtSecret, tenantResolver }
 *
 * The community shape is internally wrapped in a StaticTenantResolver so
 * the route layer doesn't have to branch on edition. Existing self-hosted
 * deployments keep working with zero config changes.
 */
export type RelayConfig =
  | RelayConfigStatic
  | RelayConfigDynamic;

export type RelayConfigStatic = {
  store: AuthRecordStore;
  jwtSecret: Uint8Array;
  identitySecret: Buffer;
  originator: string;
  /**
   * Optional Hono middleware to install BEFORE any AuthAI route. Each entry
   * gets the standard `(c, next)` signature. Use this hook for operator
   * concerns the relay deliberately doesn't ship with defaults:
   *
   *   - rate limiting (per-IP or per-JWT)
   *   - request body size caps
   *   - structured / redacted logging (NEVER log Authorization headers)
   *   - request IDs, tracing headers
   *
   * Middleware runs in the order it's listed. Errors thrown from middleware
   * short-circuit the request and surface as 500s unless the middleware
   * sets a status itself.
   */
  middleware?: MiddlewareHandler[];
};

export type RelayConfigDynamic = {
  store: AuthRecordStore;
  jwtSecret: Uint8Array;
  /**
   * Cloud editions or any caller that wants per-request tenant resolution
   * (e.g., for multi-tenant SaaS) supplies a resolver here. The resolver
   * is consulted on every non-OPTIONS request before any route handler
   * executes; returning null surfaces as a uniform 401.
   *
   * Single-tenant deploys can ignore this and use the legacy shape with
   * `originator` + `identitySecret` instead.
   */
  tenantResolver: TenantResolver;
  middleware?: MiddlewareHandler[];
};

function isStaticConfig(config: RelayConfig): config is RelayConfigStatic {
  return (config as RelayConfigStatic).originator !== undefined;
}

function validateStaticConfig(config: RelayConfigStatic): void {
  if (!config.originator || config.originator.length === 0) {
    throw new Error("createRelayApp: `originator` is required");
  }
  if (config.jwtSecret.length < 32) {
    throw new Error("createRelayApp: jwtSecret must be at least 32 bytes");
  }
  if (config.identitySecret.length < 32) {
    throw new Error("createRelayApp: identitySecret must be at least 32 bytes");
  }
  // Reject identical secrets so a leak of one doesn't compromise the other.
  // A constant-time compare avoids a length-dependent oracle even though
  // the lengths are public.
  if (config.jwtSecret.length === config.identitySecret.length) {
    const a = Buffer.from(config.jwtSecret);
    const b = config.identitySecret;
    if (timingSafeEqual(a, b)) {
      throw new Error(
        "createRelayApp: jwtSecret and identitySecret must be different",
      );
    }
  }
}

function validateDynamicConfig(config: RelayConfigDynamic): void {
  if (config.jwtSecret.length < 32) {
    throw new Error("createRelayApp: jwtSecret must be at least 32 bytes");
  }
  if (!config.tenantResolver) {
    throw new Error("createRelayApp: tenantResolver is required for dynamic config");
  }
}

export function createRelayApp(config: RelayConfig): Hono {
  let resolver: TenantResolver;
  let middleware: MiddlewareHandler[] | undefined;
  let store: AuthRecordStore;
  let jwtSecret: Uint8Array;

  if (isStaticConfig(config)) {
    validateStaticConfig(config);
    resolver = new StaticTenantResolver({
      originator: config.originator,
      identitySecret: config.identitySecret,
    });
    middleware = config.middleware;
    store = config.store;
    jwtSecret = config.jwtSecret;
  } else {
    validateDynamicConfig(config);
    resolver = config.tenantResolver;
    middleware = config.middleware;
    store = config.store;
    jwtSecret = config.jwtSecret;
  }

  const app = new Hono();

  // Operator-supplied middleware runs first so things like rate limits +
  // body size caps + request-id logging see every relay request, including
  // the auth routes where the JWT itself isn't yet known.
  if (middleware) {
    for (const mw of middleware) {
      app.use("*", mw);
    }
  }

  app.use("*", async (c, next) => {
    c.header("Access-Control-Allow-Origin", "*");
    c.header("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    c.header("Access-Control-Allow-Headers", "Content-Type, Authorization");
    c.header("Access-Control-Max-Age", "86400");
    if (c.req.method === "OPTIONS") {
      return c.body(null, 204);
    }
    await next();
  });

  app.get("/", (c) => c.json({ ok: true, service: "authai-relay" }));

  // Tenant middleware runs AFTER CORS and the operator middleware but
  // BEFORE the route groups, so /auth/* and /v1/* all see a populated
  // c.get('tenant'). The "/" health endpoint is registered above so it
  // doesn't require a tenant — useful for load balancer probes.
  app.use("*", tenantMiddleware(resolver));

  app.route("/auth", createAuthRoutes({ store, jwtSecret }));

  app.route("/v1", createV1Routes({ store, jwtSecret }));

  return app;
}

export function startBackgroundSweep(store: AuthRecordStore, intervalMs = 5 * 60 * 1000): { stop: () => void } {
  const timer = setInterval(() => {
    store.sweepExpired(Date.now()).catch(() => { /* ignore sweep errors */ });
  }, intervalMs);
  timer.unref();
  return { stop: () => clearInterval(timer) };
}
