import { describe, it, expect } from "vitest";
import type { Tenant } from "@authai/relay";
import { CloudTenantResolver } from "./tenant.js";
import { hashApiKey, generatePublishableKey } from "./identity.js";

describe("Tenant type extensions (Phase 2.1)", () => {
  it("compiles when constructed with the new fields", () => {
    const t: Tenant = {
      originator: "test",
      identitySecret: Buffer.alloc(32),
      appId: "app_1",
      resolvedVia: "publishable",
      credentialType: "publishable",
      browserDirectEnabled: true,
    };
    expect(t.resolvedVia).toBe("publishable");
    expect(t.credentialType).toBe("publishable");
    expect(t.browserDirectEnabled).toBe(true);
  });
});

function fakeContext(headers: Record<string, string>): any {
  return {
    req: { header: (name: string) => headers[name.toLowerCase()] ?? undefined },
  };
}

function fakeStore(apps: any[], origins: any[], keys: any[]): any {
  return {
    apps: {
      getByApiKeyHash: async (h: string) => apps.find((a) => a.apiKeyHash === h && !a.revokedAt) ?? null,
      getByOrigin: async (o: string) => apps.find((a) => a.origin === o && !a.revokedAt && a.credentialType === "secret") ?? null,
    },
    origins: {
      getAppByActiveOrigin: async (o: string) => {
        const row = origins.find((r) => r.origin === o && r.status === "active");
        return row ? apps.find((a) => a.id === row.appId) ?? null : null;
      },
      recordUsage: async () => {},
    },
    publishableKeys: {
      getActiveByHash: async (h: string) => {
        const k = keys.find((x) => x.keyHash === h && x.status === "active");
        if (!k) return null;
        const app = apps.find((a) => a.id === k.appId);
        return app ? { app, key: k } : null;
      },
      recordUsage: async () => {},
    },
  };
}

describe("CloudTenantResolver — publishable branch (Task 2.2)", () => {
  const masterSecret = Buffer.alloc(32, 1);

  it("resolves via publishable key + matching active origin", async () => {
    const pk = generatePublishableKey();
    const keyHash = hashApiKey(pk);
    const resolver = new CloudTenantResolver({
      masterIdentitySecret: masterSecret,
      cloudOriginator: "test",
      appStore: fakeStore(
        [{ id: "app_p", credentialType: "publishable", browserDirectEnabled: true, revokedAt: null }],
        [{ appId: "app_p", origin: "https://x.lovable.app", status: "active" }],
        [{ appId: "app_p", keyHash, status: "active" }],
      ),
    });
    const t = await resolver.resolve(fakeContext({
      "x-authai-publishable-key": pk,
      "origin": "https://x.lovable.app",
    }));
    expect(t).not.toBe("BOTH_HEADERS");
    expect((t as any)?.appId).toBe("app_p");
    expect((t as any)?.resolvedVia).toBe("publishable");
    expect((t as any)?.credentialType).toBe("publishable");
    expect((t as any)?.browserDirectEnabled).toBe(true);
  });

  it("returns null when publishable key + Origin don't match", async () => {
    const pk = generatePublishableKey();
    const keyHash = hashApiKey(pk);
    const resolver = new CloudTenantResolver({
      masterIdentitySecret: masterSecret,
      cloudOriginator: "test",
      appStore: fakeStore(
        [{ id: "app_p", credentialType: "publishable", browserDirectEnabled: true, revokedAt: null }],
        [{ appId: "app_p", origin: "https://x.lovable.app", status: "active" }],
        [{ appId: "app_p", keyHash, status: "active" }],
      ),
    });
    const t = await resolver.resolve(fakeContext({
      "x-authai-publishable-key": pk,
      "origin": "https://evil.com",
    }));
    expect(t).toBeNull();
  });

  it("returns null when browser_direct_enabled is false", async () => {
    const pk = generatePublishableKey();
    const keyHash = hashApiKey(pk);
    const resolver = new CloudTenantResolver({
      masterIdentitySecret: masterSecret,
      cloudOriginator: "test",
      appStore: fakeStore(
        [{ id: "app_p", credentialType: "publishable", browserDirectEnabled: false, revokedAt: null }],
        [{ appId: "app_p", origin: "https://x.lovable.app", status: "active" }],
        [{ appId: "app_p", keyHash, status: "active" }],
      ),
    });
    const t = await resolver.resolve(fakeContext({
      "x-authai-publishable-key": pk,
      "origin": "https://x.lovable.app",
    }));
    expect(t).toBeNull();
  });

  it("returns 'BOTH_HEADERS' sentinel when both secret + publishable headers present", async () => {
    const resolver = new CloudTenantResolver({
      masterIdentitySecret: masterSecret,
      cloudOriginator: "test",
      appStore: fakeStore([], [], []),
    });
    const t = await resolver.resolve(fakeContext({
      "x-authai-secret": "authai_v1_xxx",
      "x-authai-publishable-key": "authai_pk_xxx",
    }));
    expect(t).toBe("BOTH_HEADERS");
  });

  it("secret-app Origin-only resolution still works (backward compat)", async () => {
    const sec = "authai_v1_sec";
    const resolver = new CloudTenantResolver({
      masterIdentitySecret: masterSecret,
      cloudOriginator: "test",
      appStore: fakeStore(
        [{ id: "app_s", apiKeyHash: hashApiKey(sec), origin: "https://my.com",
          credentialType: "secret", browserDirectEnabled: true, revokedAt: null }],
        [], [],
      ),
    });
    const t = await resolver.resolve(fakeContext({ "origin": "https://my.com" }));
    expect((t as any)?.appId).toBe("app_s");
    expect((t as any)?.resolvedVia).toBe("origin");
    expect((t as any)?.credentialType).toBe("secret");
  });
});
