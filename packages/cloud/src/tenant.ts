import type { Context } from "hono";
import type { TenantResolver, Tenant, CredentialResolutionMethod } from "@authai/relay";
import type { AppStore, AppRow } from "@authai/relay-store-postgres";
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
 * Cloud-edition resolver. Looks up the app row by one of three methods:
 *
 *   1. `x-authai-secret` header (builder backend calling /v1/*)
 *   2. `x-authai-publishable-key` header + matching `Origin` (browser
 *      calling /auth/* with a publishable key)
 *   3. `Origin` header alone (legacy secret-app browser sign-in only)
 *
 * Returns null if no match → uniform 401 at the tenant middleware.
 * Returns "BOTH_HEADERS" if both secret + publishable key headers are
 * present → middleware emits 400 conflicting_credentials.
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

  async resolve(c: Context): Promise<Tenant | null | "BOTH_HEADERS"> {
    const apiSecret = c.req.header("x-authai-secret");
    const publishableKey = c.req.header("x-authai-publishable-key");

    // Both headers → reject; middleware will 400 conflicting_credentials.
    if (apiSecret && publishableKey) return "BOTH_HEADERS";

    // Preference 1: secret header → look up by hashed secret. The builder
    // backend sends this on every /v1/* call (it's the AUTH_AI_SECRET
    // they wrote to .env from the npx CLI). The header name is
    // deliberately `x-authai-secret` rather than `x-authai-key` so it's
    // obvious to anyone debugging traffic that the value must not be
    // shared or logged.
    if (apiSecret) {
      const hash = hashApiKey(apiSecret);
      const app = await this.config.appStore.apps.getByApiKeyHash(hash);
      // appStore.getByApiKeyHash already excludes revoked apps via
      // `revoked_at IS NULL` in the SQL — a revoke from the dashboard
      // takes effect on the very next request.
      if (!app || app.credentialType !== "secret") return null;
      return this.buildTenant(app, "secret");
    }

    // Preference 2: publishable header → look up key, then check Origin
    // against app's active origins. Both must match for a valid resolution.
    if (publishableKey) {
      const hash = hashApiKey(publishableKey);
      const result = await this.config.appStore.publishableKeys.getActiveByHash(hash);
      if (!result) return null;
      const { app, key } = result;
      if (app.credentialType !== "publishable") return null;
      if (!app.browserDirectEnabled) return null;
      const rawOrigin = c.req.header("origin");
      if (!rawOrigin) return null;
      const origin = normalizeOrigin(rawOrigin);
      if (!origin) return null;
      const matchedApp = await this.config.appStore.origins.getAppByActiveOrigin(origin);
      if (!matchedApp || matchedApp.id !== app.id) return null;
      // Fire-and-forget usage recording (no await — must not block the request).
      void this.config.appStore.publishableKeys.recordUsage(key.id, ipFromContext(c)).catch(() => {});
      return this.buildTenant(app, "publishable");
    }

    // Preference 3: Origin header alone (legacy secret-app browser sign-in).
    // Normalize before lookup so a builder who registered
    // "https://example.com/" and a browser sending the standard
    // `Origin: https://example.com` (no trailing slash, no path) hit the
    // same row.
    const rawOrigin = c.req.header("origin");
    const origin = rawOrigin ? normalizeOrigin(rawOrigin) : "";
    if (origin) {
      const app = await this.config.appStore.apps.getByOrigin(origin);
      if (!app || app.credentialType !== "secret") return null;
      return this.buildTenant(app, "origin");
    }

    // Neither header — no tenant; middleware returns uniform 401.
    return null;
  }

  private buildTenant(app: AppRow, resolvedVia: CredentialResolutionMethod): Tenant {
    return {
      originator: this.config.cloudOriginator,
      identitySecret: derivePerAppIdentitySecret(
        this.config.masterIdentitySecret,
        app.id,
      ),
      appId: app.id,
      resolvedVia,
      credentialType: app.credentialType,
      browserDirectEnabled: app.browserDirectEnabled,
    };
  }
}

function ipFromContext(c: Context): string {
  return c.req.header("x-forwarded-for")?.split(",")[0]?.trim()
    ?? c.req.header("x-real-ip")
    ?? "unknown";
}
