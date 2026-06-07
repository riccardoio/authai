/**
 * AuthAI Cloud relay server boot — pure data-plane.
 *
 * Wires:
 *   - Postgres-backed store (auth records + apps + audit_events)
 *   - Redis-backed kill switch + per-app rate limiter
 *   - CloudTenantResolver pulling tenant from x-authai-secret or Origin header
 *   - The /auth/* and /v1/* relay routes via @authai/relay
 *
 * App registration, dashboard, and builder identity live in apps/cloud-web
 * (the Next.js webapp at authai.io). The relay reads the apps
 * table; the webapp writes it. They share data, not code.
 *
 * Deploy target: Hetzner box via Dokku, served behind `relay.authai.io`.
 *
 * Self-hosted single-tenant setup uses apps/relay-server instead.
 */

import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { Redis } from "ioredis";
import {
  createRelayApp,
  startBackgroundSweep,
} from "@authai/relay";
import { createPostgresStore } from "@authai/relay-store-postgres";
import {
  CloudTenantResolver,
  createKillSwitch,
  createRateLimiter,
  resolveEdition,
  type KillSwitchEvent,
} from "@authai/cloud";

function required(name: string): string {
  const value = process.env[name];
  if (!value || value.length === 0) {
    console.error(`[cloud-relay-server] missing required env var: ${name}`);
    process.exit(1);
  }
  return value;
}

/**
 * Like `required`, but accepts any of the given names. First non-empty
 * wins. Used so AUTH_AI_DATABASE_URL coexists with Dokku's
 * auto-injected DATABASE_URL (Dokku's postgres:link sets DATABASE_URL
 * and rotates it on credential changes; we read it directly so we
 * don't have to mirror env vars manually after every rotation).
 */
function requiredFromAny(names: string[]): string {
  for (const name of names) {
    const v = process.env[name];
    if (v && v.length > 0) return v;
  }
  console.error(
    `[cloud-relay-server] missing required env var; tried: ${names.join(", ")}`,
  );
  process.exit(1);
}

const edition = resolveEdition(process.env.AUTH_AI_EDITION ?? "cloud");
if (edition !== "cloud") {
  console.error(
    "[cloud-relay-server] this app expects AUTH_AI_EDITION=cloud. " +
      "Use apps/relay-server for self-hosted community deploys.",
  );
  process.exit(1);
}

const port = Number(process.env.AUTH_AI_PORT ?? 3000);
const cloudOriginator = process.env.AUTH_AI_CLOUD_ORIGINATOR ?? "AuthAI Cloud";
const webAppUrl = (process.env.AUTH_AI_CLOUD_WEB_URL ?? "https://authai.io")
  .replace(/\/$/, "");

const jwtSecret = new Uint8Array(Buffer.from(required("AUTH_AI_JWT_SECRET"), "hex"));
const masterIdentitySecret = Buffer.from(
  required("AUTH_AI_CLOUD_MASTER_SECRET"),
  "hex",
);

if (jwtSecret.length < 32 || masterIdentitySecret.length < 32) {
  console.error(
    "[cloud-relay-server] secrets must be at least 32 bytes hex " +
      "(use `openssl rand -hex 32`)",
  );
  process.exit(1);
}

const databaseUrl = requiredFromAny(["AUTH_AI_DATABASE_URL", "DATABASE_URL"]);
const redisUrl = requiredFromAny(["AUTH_AI_REDIS_URL", "REDIS_URL"]);
const dailyRequestCap = Number(process.env.AUTH_AI_CLOUD_DAILY_CAP ?? "5000");

console.log("[cloud-relay-server] connecting to Postgres + Redis...");
const store = await createPostgresStore({ connectionString: databaseUrl });
const redis = new Redis(redisUrl);

const killSwitchEventLog = (event: KillSwitchEvent) => {
  // Simplest possible alert path: structured stderr JSON. Operators wire
  // Fly logs → external pager (PagerDuty, Slack, etc.).
  console.error(
    JSON.stringify({
      kind: "authai.cloud.kill_switch_event",
      ts: new Date().toISOString(),
      ...event,
    }),
  );
};

const killSwitch = createKillSwitch({
  redis,
  dailyRequestCap,
  onStateChange: killSwitchEventLog,
});

const rateLimiter = createRateLimiter({
  redis,
  onUnreachable: (err) =>
    console.error(
      JSON.stringify({
        kind: "authai.cloud.rate_limiter_unreachable",
        ts: new Date().toISOString(),
        error: err,
      }),
    ),
});

const tenantResolver = new CloudTenantResolver({
  masterIdentitySecret,
  appStore: store.apps,
  cloudOriginator,
});

const relayApp = createRelayApp({
  store,
  jwtSecret,
  tenantResolver,
  middleware: [
    // Kill switch sees every request before the tenant resolver. Only
    // `paused-new` is reachable in v1 — and it intentionally only blocks
    // new sign-ins, leaving in-flight users (existing JWTs against /v1/*)
    // working. See packages/cloud/src/kill-switch.ts for the recovery
    // procedure when the daily counter trips early.
    async (c, next) => {
      const state = await killSwitch.currentState();
      if (state === "paused-new" && c.req.path.startsWith("/auth/start")) {
        return c.json(
          {
            error: "AuthAI Cloud is temporarily paused for new sign-ins. " +
              "Try again later.",
          },
          503,
        );
      }
      return next();
    },

    // Per-app rate limit on /v1/*. This middleware runs BEFORE
    // @authai/relay's own tenantMiddleware, so we resolve the tenant
    // here and pin it onto context. tenantMiddleware is idempotent and
    // skips its own DB call when the tenant is already set — net result
    // is a single resolve per request even though two middlewares need
    // the tenant.
    async (c, next) => {
      if (!c.req.path.startsWith("/v1/")) return next();
      const tenant = await tenantResolver.resolve(c);
      if (!tenant?.appId) return next(); // tenantMiddleware will 401
      c.set("tenant", tenant);
      const app = await store.apps.getById(tenant.appId);
      if (!app) return next();
      const decision = await rateLimiter.check(app.id, app.rateLimitPerMin);
      if (!decision.allowed) {
        c.header("Retry-After", String(decision.retryAfterSeconds));
        return c.json(
          {
            error: {
              message: "rate limit exceeded",
              type: "rate_limit_error",
            },
          },
          429,
        );
      }
      // Global daily cap recorded AFTER per-app check so one bad-actor app
      // can't burn the global cap by itself.
      await killSwitch.recordRequest();
      return next();
    },
  ],
});

// Root composition:
//   /healthz   liveness for Fly
//   /          → 302 to the webapp (relay is data-plane only)
//   /auth/*    relay
//   /v1/*      relay
const root = new Hono();

root.get("/healthz", (c) =>
  c.json({ ok: true, edition: "cloud", originator: cloudOriginator }),
);

// Anyone hitting the relay's apex gets pointed at the webapp. Saves us
// from having to host any UI on the relay process.
root.get("/", (c) => c.redirect(webAppUrl, 302));

root.route("/", relayApp);

startBackgroundSweep(store);

serve({ fetch: root.fetch, port }, (info) => {
  console.log(
    `[cloud-relay-server] listening on http://localhost:${info.port} ` +
      `(edition=cloud, daily_cap=${dailyRequestCap}, webapp=${webAppUrl})`,
  );
});
