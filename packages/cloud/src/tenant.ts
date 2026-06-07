import type { Context } from "hono";
import type { TenantResolver, Tenant } from "@authai/relay";
import type { AppStore } from "@authai/relay-store-postgres";
import { derivePerAppIdentitySecret, hashApiKey, normalizeOrigin } from "./identity.js";

export type CloudTenantConfig = {
  /**
   * 32-byte master secret. Per-app identitySecrets are HKDF-derived from
   * this + the appId. Never persisted to disk by the relay process itself
   * — passed in by the runtime via env (e.g., AUTH_AI_CLOUD_MASTER_SECRET).
   */
  masterIdentitySecret: Buffer;

  /**
   * The apps table backing the resolver. Same one written to by the
   * webapp.
   */
  appStore: AppStore;

  /**
   * The brand the relay reports to upstream providers as the device-code
   * `originator`. The hosted relay deliberately uses a single global
   * originator across all tenants — the provider's consent screen always
   * says "AuthAI Cloud" regardless of which builder's app is requesting
   * sign-in. Per-app branding would require per-app provider OAuth clients,
   * which is a v2 problem.
   */
  cloudOriginator: string;
};

/**
 * Cloud-edition resolver. Looks up the app row by either:
 *
 *   1. `x-authai-key` header (used by builder backends calling /v1/*)
 *   2. `Origin` header (used by browser-originating /auth/* requests)
 *
 * Returns null if no match → uniform 401 at the tenant middleware.
 *
 * No caching — every request hits the apps table. The lookups are
 * point reads against unique indexes (`api_key_hash` and `origin`) and
 * cost ~1ms on warm Postgres. Adding a cache reintroduces the revocation
 * problem the eng-review surfaced (a builder revokes via the dashboard
 * but the relay keeps serving them for the cache TTL). When traffic is
 * high enough to warrant caching, the right fix is a Redis pub/sub
 * channel invalidating relay nodes on revoke — not a TTL.
 */
export class CloudTenantResolver implements TenantResolver {
  constructor(private readonly config: CloudTenantConfig) {}

  async resolve(c: Context): Promise<Tenant | null> {
    // Preference 1: explicit AuthAI Cloud key in header. The builder
    // backend sends this on every /v1/* call (it's the AUTH_AI_KEY
    // they wrote to .env from the npx CLI).
    const apiKey = c.req.header("x-authai-key");
    if (apiKey) {
      const hash = hashApiKey(apiKey);
      const app = await this.config.appStore.getByApiKeyHash(hash);
      // appStore.getByApiKeyHash already excludes revoked apps via
      // `revoked_at IS NULL` in the SQL — a revoke from the dashboard
      // takes effect on the very next request.
      if (!app) return null;
      return this.buildTenant(app.id);
    }

    // Preference 2: Origin header lookup. Browser sign-in flows arrive at
    // /auth/start with an Origin set by the browser. The relay matches
    // it to apps.origin (registered at app creation time).
    //
    // Normalize before lookup so a builder who registered
    // "https://example.com/" and a browser sending the standard
    // `Origin: https://example.com` (no trailing slash, no path) hit the
    // same row. Without this, every builder who pasted a URL with a
    // trailing slash gets a silent tenant-resolution miss.
    const rawOrigin = c.req.header("origin");
    const origin = rawOrigin ? normalizeOrigin(rawOrigin) : null;
    if (origin) {
      const app = await this.config.appStore.getByOrigin(origin);
      if (!app) return null;
      return this.buildTenant(app.id);
    }

    // Neither header — no tenant; middleware returns uniform 401.
    return null;
  }

  private buildTenant(appId: string): Tenant {
    return {
      originator: this.config.cloudOriginator,
      identitySecret: derivePerAppIdentitySecret(
        this.config.masterIdentitySecret,
        appId,
      ),
      appId,
    };
  }
}
