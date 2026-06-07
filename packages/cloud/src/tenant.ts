import type { Context } from "hono";
import type { TenantResolver, Tenant } from "@authai/relay";
import type { AppStore } from "@authai/relay-store-postgres";
import { derivePerAppIdentitySecret, hashApiKey } from "./identity.js";

export type CloudTenantConfig = {
  /**
   * 32-byte master secret. Per-app identitySecrets are HKDF-derived from
   * this + the appId. Never persisted to disk by the relay process itself
   * — passed in by the runtime via env (e.g., AUTH_AI_CLOUD_MASTER_SECRET).
   */
  masterIdentitySecret: Buffer;

  /**
   * The apps table backing the resolver. Same one written to by the admin
   * routes.
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

  /**
   * Optional in-memory cache for resolved tenants. Lookups by Origin or
   * api key on every request would hammer Postgres; a 30s TTL is plenty.
   * Pass null to disable caching (useful in tests).
   */
  cache?: TenantCache | null;
};

export interface TenantCache {
  get(key: string): Tenant | null;
  set(key: string, value: Tenant): void;
}

export function createMemoryCache(opts: { ttlMs?: number } = {}): TenantCache {
  const ttl = opts.ttlMs ?? 30_000;
  type Entry = { value: Tenant; expiresAt: number };
  const map = new Map<string, Entry>();
  return {
    get(key) {
      const entry = map.get(key);
      if (!entry) return null;
      if (Date.now() > entry.expiresAt) {
        map.delete(key);
        return null;
      }
      return entry.value;
    },
    set(key, value) {
      map.set(key, { value, expiresAt: Date.now() + ttl });
    },
  };
}

/**
 * Cloud-edition resolver. Looks up the app row by either:
 *
 *   1. `x-authai-key` header (used by builder backends calling /v1/*)
 *   2. `Origin` header (used by browser-originating /auth/* requests)
 *
 * Returns null if no match → uniform 401 at the tenant middleware.
 *
 * The resolver does NOT enforce origin verification (verified vs
 * ephemeral bucket); that's enforced by the rate-limit middleware
 * downstream, which reads tenant.appId to apply per-app limits.
 */
export class CloudTenantResolver implements TenantResolver {
  constructor(private readonly config: CloudTenantConfig) {}

  async resolve(c: Context): Promise<Tenant | null> {
    const cache = this.config.cache;

    // Preference 1: explicit AuthAI Cloud key in header. The builder
    // backend sends this on every /v1/* call (it's the AUTH_AI_KEY
    // they wrote to .env from the npx CLI).
    const apiKey = c.req.header("x-authai-key");
    if (apiKey) {
      const cacheKey = `k:${apiKey}`;
      const cached = cache?.get(cacheKey);
      if (cached) return cached;

      const hash = hashApiKey(apiKey);
      const app = await this.config.appStore.getByApiKeyHash(hash);
      if (!app) return null;
      const tenant = this.buildTenant(app.id);
      cache?.set(cacheKey, tenant);
      return tenant;
    }

    // Preference 2: Origin header lookup. Browser sign-in flows arrive at
    // /auth/start with an Origin set by the browser. The relay matches
    // it to apps.origin (registered at app creation time).
    const origin = c.req.header("origin");
    if (origin) {
      const cacheKey = `o:${origin}`;
      const cached = cache?.get(cacheKey);
      if (cached) return cached;

      const app = await this.config.appStore.getByOrigin(origin);
      if (!app) return null;
      const tenant = this.buildTenant(app.id);
      cache?.set(cacheKey, tenant);
      return tenant;
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
