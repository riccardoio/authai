import { Hono, type Context } from "hono";
import { ulid } from "ulid";
import type {
  AppStore,
  AuditEventStore,
  AppRow,
} from "@authai/relay-store-postgres";
import {
  generateApiKey,
  hashApiKey,
  generateVerifyToken,
} from "./identity.js";
import {
  fetchGithubUser,
  issueAdminJwt,
  verifyAdminJwt,
} from "./admin-auth.js";

export type AdminRoutesConfig = {
  appStore: AppStore;
  auditStore: AuditEventStore;
  /**
   * Secret used to sign admin session JWTs. Independent from the relay's
   * user-session JWT secret (different key, different audience) so an
   * admin JWT can never be replayed against /v1/* and vice versa.
   */
  adminJwtSecret: Uint8Array;
};

type AdminVariables = {
  Variables: {
    admin: { githubUserId: string; githubLogin: string; githubEmail?: string };
  };
};

type AdminContext = Context<AdminVariables>;

export function createAdminRoutes(config: AdminRoutesConfig): Hono<AdminVariables> {
  const app = new Hono<AdminVariables>();

  /**
   * POST /admin/login
   *
   * Body: { github_access_token: string }
   *
   * Exchange a GitHub OAuth token (obtained by the CLI's device-code flow)
   * for an admin session JWT. Returns the JWT + user profile for display.
   */
  app.post("/login", async (c) => {
    let body: any;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: "invalid json body" }, 400);
    }
    const token = body?.github_access_token;
    if (typeof token !== "string" || token.length === 0) {
      return c.json({ error: "github_access_token required" }, 400);
    }

    let profile;
    try {
      profile = await fetchGithubUser(token);
    } catch (err) {
      return c.json(
        { error: `github lookup failed: ${(err as Error).message}` },
        502,
      );
    }

    const jwt = await issueAdminJwt({
      githubUserId: profile.id,
      githubLogin: profile.login,
      githubEmail: profile.email,
      secret: config.adminJwtSecret,
    });

    return c.json({
      admin_jwt: jwt,
      user: { id: profile.id, login: profile.login, email: profile.email },
    });
  });

  // Admin auth gate. Everything below /login requires a valid admin JWT.
  app.use("/apps/*", async (c, next) => {
    if (c.req.method === "OPTIONS") return next();
    const auth = c.req.header("Authorization") || "";
    const match = auth.match(/^Bearer\s+(.+)$/i);
    if (!match) return c.json({ error: "unauthorized" }, 401);
    try {
      const claims = await verifyAdminJwt(match[1]!, config.adminJwtSecret);
      c.set("admin", claims);
    } catch {
      return c.json({ error: "unauthorized" }, 401);
    }
    return next();
  });
  app.use("/apps", async (c, next) => {
    if (c.req.method === "OPTIONS") return next();
    const auth = c.req.header("Authorization") || "";
    const match = auth.match(/^Bearer\s+(.+)$/i);
    if (!match) return c.json({ error: "unauthorized" }, 401);
    try {
      const claims = await verifyAdminJwt(match[1]!, config.adminJwtSecret);
      c.set("admin", claims);
    } catch {
      return c.json({ error: "unauthorized" }, 401);
    }
    return next();
  });

  /**
   * POST /admin/apps
   *
   * Body: { name: string, origin: string }
   *
   * Create a new app for the authenticated GitHub user. Returns the
   * generated API key (shown ONCE — relay only stores the hash) plus
   * the DNS TXT verification token the builder needs to publish before
   * the origin is auto-promoted out of the ephemeral-rate-limit bucket.
   */
  app.post("/apps", async (c) => {
    const admin = c.get("admin");
    let body: any;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: "invalid json body" }, 400);
    }
    if (typeof body?.name !== "string" || body.name.length === 0 || body.name.length > 80) {
      return c.json({ error: "name (1-80 chars) required" }, 400);
    }
    if (typeof body?.origin !== "string" || !isValidOrigin(body.origin)) {
      return c.json({ error: "origin must be a valid http(s) URL" }, 400);
    }

    // Reject if origin is already taken by another app. The DB UNIQUE
    // constraint would catch this too, but the early return surfaces a
    // clearer message than "duplicate key".
    const existing = await config.appStore.getByOrigin(body.origin);
    if (existing) {
      return c.json({ error: "origin already in use by another app" }, 409);
    }

    const id = `app_${ulid()}`;
    const apiKey = generateApiKey();
    const apiKeyHash = hashApiKey(apiKey);
    const verifyToken = generateVerifyToken();
    const now = Date.now();

    // Auto-verify localhost + ephemeral preview origins so the first-run
    // demo doesn't require DNS work. They're rate-limit-capped at the
    // ephemeral bucket regardless of this flag (enforced in Lane C's
    // rate-limit middleware).
    const autoVerified = isAutoAllowedOrigin(body.origin);

    const app = await config.appStore.create({
      id,
      apiKeyHash,
      origin: body.origin,
      name: body.name,
      ownerGithubId: admin.githubUserId,
      ownerEmail: admin.githubEmail,
      originVerified: autoVerified,
      originVerifiedAt: autoVerified ? now : undefined,
      originVerifyToken: verifyToken,
      rateLimitPerMin: 60,
      dailyRequestCap: autoVerified ? 1000 : 100,
    });

    await config.auditStore.write({
      id: ulid(),
      ts: now,
      actorType: "owner",
      actorId: admin.githubUserId,
      appId: id,
      eventType: "app_created",
      payload: {
        owner_github_login: admin.githubLogin,
        origin: body.origin,
        auto_verified: autoVerified,
      },
    });

    return c.json({
      app: publicAppView(app),
      // Returned ONCE. Builder copies this into their .env as AUTH_AI_KEY.
      api_key: apiKey,
      // Builder publishes this as `TXT authai-verify=<token>` on their
      // origin to lift the ephemeral-bucket rate limit. Auto-allowed
      // origins skip this step.
      verify_dns_txt: autoVerified ? null : `authai-verify=${verifyToken}`,
    });
  });

  /**
   * GET /admin/apps
   *
   * List apps owned by the authenticated GitHub user. Returns only the
   * public view — never the api_key (only emitted at creation time).
   */
  app.get("/apps", async (c) => {
    const admin = c.get("admin");
    const apps = await config.appStore.listByOwner(admin.githubUserId);
    return c.json({ apps: apps.map(publicAppView) });
  });

  /**
   * DELETE /admin/apps/:id
   *
   * Revoke an app. Sets revoked_at; subsequent CloudTenantResolver
   * lookups by origin/key skip revoked rows (returning null → uniform 401
   * for any in-flight JWTs). Records remain in the DB for audit purposes;
   * a background sweep removes expired auth_records as normal.
   */
  app.delete("/apps/:id", async (c) => {
    const admin = c.get("admin");
    const id = c.req.param("id");
    const existing = await config.appStore.getById(id);
    if (!existing) return c.json({ error: "not found" }, 404);
    if (existing.ownerGithubId !== admin.githubUserId) {
      return c.json({ error: "not found" }, 404); // 404 not 403 — no enum oracle.
    }
    if (existing.revokedAt) return c.json({ ok: true, already_revoked: true });

    const now = Date.now();
    await config.appStore.revoke(id, now);
    await config.auditStore.write({
      id: ulid(),
      ts: now,
      actorType: "owner",
      actorId: admin.githubUserId,
      appId: id,
      eventType: "app_kill_switched",
      payload: { initiated_by: "owner", reason: "delete via admin api" },
    });

    return c.json({ ok: true });
  });

  return app;
}

function isValidOrigin(origin: string): boolean {
  try {
    const url = new URL(origin);
    if (url.protocol !== "http:" && url.protocol !== "https:") return false;
    // Reject anything with a path or query — origin means just scheme + host
    // + optional port. Builders sometimes paste a full URL by accident.
    return url.pathname === "/" && url.search === "" && url.hash === "";
  } catch {
    return false;
  }
}

function isAutoAllowedOrigin(origin: string): boolean {
  try {
    const url = new URL(origin);
    if (url.hostname === "localhost") return true;
    if (url.hostname === "127.0.0.1") return true;
    if (url.hostname.endsWith(".vercel.app")) return true;
    return false;
  } catch {
    return false;
  }
}

function publicAppView(app: AppRow) {
  return {
    id: app.id,
    name: app.name,
    origin: app.origin,
    origin_verified: app.originVerified,
    rate_limit_per_min: app.rateLimitPerMin,
    daily_request_cap: app.dailyRequestCap,
    created_at: app.createdAt,
  };
}
