/**
 * AuthAI Cloud relay server boot.
 *
 * Wires:
 *   - Postgres-backed store + apps + audit
 *   - Redis-backed kill switch + per-app rate limiter
 *   - CloudTenantResolver pulling tenant from x-authai-key or Origin header
 *   - Admin routes for /admin/* (app registration, GitHub OAuth handoff)
 *   - The standard /auth/* and /v1/* relay routes via @authai/relay
 *
 * Self-host setup uses apps/relay-server instead — this server is the
 * cloud edition only.
 *
 * Required env vars are loud-fail. Optional env vars have safe defaults.
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
  createAdminRoutes,
  createKillSwitch,
  createRateLimiter,
  createMemoryCache,
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

// Secrets (all 32-byte hex).
const jwtSecret = new Uint8Array(Buffer.from(required("AUTH_AI_JWT_SECRET"), "hex"));
const adminJwtSecret = new Uint8Array(
  Buffer.from(required("AUTH_AI_ADMIN_JWT_SECRET"), "hex"),
);
const masterIdentitySecret = Buffer.from(
  required("AUTH_AI_CLOUD_MASTER_SECRET"),
  "hex",
);

if (
  jwtSecret.length < 32 ||
  adminJwtSecret.length < 32 ||
  masterIdentitySecret.length < 32
) {
  console.error(
    "[cloud-relay-server] secrets must be at least 32 bytes hex " +
      "(use `openssl rand -hex 32`)",
  );
  process.exit(1);
}

const databaseUrl = required("AUTH_AI_DATABASE_URL");
const redisUrl = required("AUTH_AI_REDIS_URL");

// Daily cost cap is the hard wall against runaway bills. The soft threshold
// (default 80%) triggers `paused-new` ahead of the cliff. Defaults are safe
// for a hobby project: 5000/day = ~150 ChatGPT requests/min sustained.
const dailyRequestCap = Number(process.env.AUTH_AI_CLOUD_DAILY_CAP ?? "5000");

console.log("[cloud-relay-server] connecting to Postgres + Redis...");
const store = await createPostgresStore({ connectionString: databaseUrl });
const redis = new Redis(redisUrl);

const killSwitchEventLog = (event: KillSwitchEvent) => {
  // The simplest possible alert path: log to stderr in structured JSON.
  // Operators wire fly logs → an external pager (PagerDuty, Slack, etc.).
  // Wave-2 of cloud hosting can replace this with a real webhook.
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
  cache: createMemoryCache({ ttlMs: 30_000 }),
});

const relayApp = createRelayApp({
  store,
  jwtSecret,
  tenantResolver,
  middleware: [
    // Kill switch sees every request before the tenant resolver. paused-new
    // returns 503 from /auth/start (the new-sign-in path); read-only blocks
    // /v1/*. Other paths pass through.
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
      if (state === "read-only" && c.req.path.startsWith("/v1/")) {
        return c.json(
          {
            error: {
              message: "AuthAI Cloud is temporarily read-only.",
              type: "service_unavailable",
            },
          },
          503,
        );
      }
      return next();
    },

    // Per-app rate limit. Runs after tenant resolution would but pulls
    // tenant out of context — we re-resolve here cheaply because the
    // CloudTenantResolver cache keeps Postgres pressure low.
    async (c, next) => {
      // Only enforce on /v1/* — admin paths and /auth flow have their own
      // caps elsewhere.
      if (!c.req.path.startsWith("/v1/")) return next();
      const tenant = await tenantResolver.resolve(c);
      if (!tenant?.appId) return next(); // fall through; the tenant middleware will 401
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
      // Count toward the global daily cap. Doing this AFTER the per-app
      // check means a single bad-actor app can't burn the global cap by
      // itself — its per-app limit cuts in first.
      await killSwitch.recordRequest();
      return next();
    },
  ],
});

const adminRoutes = createAdminRoutes({
  appStore: store.apps,
  auditStore: store.audit,
  adminJwtSecret,
});

// Compose: relayApp handles /, /auth/*, /v1/*; we mount admin under /admin.
const root = new Hono();
root.route("/", relayApp);
root.route("/admin", adminRoutes);

// Health endpoint reachable independent of any DB/Redis state — Fly uses
// this for liveness probes.
root.get("/healthz", (c) =>
  c.json({ ok: true, edition: "cloud", originator: cloudOriginator }),
);

startBackgroundSweep(store);

serve({ fetch: root.fetch, port }, (info) => {
  console.log(
    `[cloud-relay-server] listening on http://localhost:${info.port} ` +
      `(edition=cloud, daily_cap=${dailyRequestCap})`,
  );
});
