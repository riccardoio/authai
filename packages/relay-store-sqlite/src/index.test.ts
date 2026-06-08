import { describe, it, expect, beforeEach } from "vitest";
import { createStore } from "./index.js";

describe("SQLite store — new credential/origin columns", () => {
  let store: ReturnType<typeof createStore>;

  beforeEach(() => {
    store = createStore({ url: ":memory:" });
  });

  it("apps table has credential_type column (defaults to 'secret')", async () => {
    const created = await store.apps.create({
      id: "app_1",
      apiKeyHash: "h1",
      origin: "https://example.com",
      name: "Test",
      ownerGithubId: "ghid",
      originVerifyToken: "t",
    });
    expect(created.credentialType).toBe("secret");
    expect(created.browserDirectEnabled).toBe(true);
  });

  it("apps table accepts credential_type='publishable'", async () => {
    const created = await store.apps.create({
      id: "app_2",
      apiKeyHash: "h2",
      origin: "https://example2.com",
      name: "Test",
      ownerGithubId: "ghid",
      originVerifyToken: "t",
      credentialType: "publishable",
    });
    expect(created.credentialType).toBe("publishable");
  });
});

describe("SQLite store — app_origins table", () => {
  let store: ReturnType<typeof createStore>;

  beforeEach(() => {
    store = createStore({ url: ":memory:" });
  });

  it("addOrigin inserts a row and listForApp returns it", async () => {
    await store.apps.create({
      id: "app_1",
      apiKeyHash: "h",
      origin: "https://a.com",
      name: "n",
      ownerGithubId: "g",
      originVerifyToken: "t",
    });
    const origin = await store.origins.add({
      appId: "app_1",
      origin: "https://b.example.com",
      tier: "production",
    });
    expect(origin.id).toMatch(/^.{10,}$/);
    expect(origin.status).toBe("active");
    const list = await store.origins.listForApp("app_1");
    expect(list.find((o) => o.origin === "https://b.example.com")).toBeDefined();
  });

  it("getAppByActiveOrigin returns the app for an active matching origin", async () => {
    await store.apps.create({
      id: "app_1",
      apiKeyHash: "h",
      origin: "https://a.com",
      name: "n",
      ownerGithubId: "g",
      originVerifyToken: "t",
      credentialType: "publishable",
    });
    await store.origins.add({
      appId: "app_1",
      origin: "https://b.com",
      tier: "production",
    });
    const app = await store.origins.getAppByActiveOrigin("https://b.com");
    expect(app?.id).toBe("app_1");
  });

  it("getAppByActiveOrigin returns null for disabled origin", async () => {
    await store.apps.create({
      id: "app_1",
      apiKeyHash: "h",
      origin: "https://a.com",
      name: "n",
      ownerGithubId: "g",
      originVerifyToken: "t",
      credentialType: "publishable",
    });
    const origin = await store.origins.add({
      appId: "app_1",
      origin: "https://b.com",
      tier: "production",
    });
    await store.origins.setStatus(origin.id, "disabled");
    const app = await store.origins.getAppByActiveOrigin("https://b.com");
    expect(app).toBeNull();
  });

  it("origin global uniqueness — adding the same origin to a second app fails", async () => {
    await store.apps.create({
      id: "app_1",
      apiKeyHash: "h1",
      origin: "https://a.com",
      name: "n",
      ownerGithubId: "g",
      originVerifyToken: "t1",
    });
    await store.apps.create({
      id: "app_2",
      apiKeyHash: "h2",
      origin: "https://x.com",
      name: "n2",
      ownerGithubId: "g",
      originVerifyToken: "t2",
    });
    await store.origins.add({
      appId: "app_1",
      origin: "https://shared.com",
      tier: "production",
    });
    await expect(
      store.origins.add({
        appId: "app_2",
        origin: "https://shared.com",
        tier: "production",
      }),
    ).rejects.toThrow();
  });
});

describe("SQLite store — app_publishable_keys table", () => {
  let store: ReturnType<typeof createStore>;

  beforeEach(() => {
    store = createStore({ url: ":memory:" });
  });

  it("createKey inserts a row and listForApp returns it", async () => {
    await store.apps.create({
      id: "app_1",
      apiKeyHash: "h",
      origin: "https://a.com",
      name: "n",
      ownerGithubId: "g",
      originVerifyToken: "t",
      credentialType: "publishable",
    });
    const created = await store.publishableKeys.create({
      appId: "app_1",
      keyHash: "deadbeef",
      label: "initial",
      createdBy: "ghid",
    });
    expect(created.status).toBe("active");
    expect(created.label).toBe("initial");
    const list = await store.publishableKeys.listForApp("app_1");
    expect(list).toHaveLength(1);
  });

  it("getActiveByHash returns the app for an active publishable-key hash", async () => {
    await store.apps.create({
      id: "app_1",
      apiKeyHash: "h",
      origin: "https://a.com",
      name: "n",
      ownerGithubId: "g",
      originVerifyToken: "t",
      credentialType: "publishable",
    });
    await store.publishableKeys.create({
      appId: "app_1",
      keyHash: "deadbeef",
      createdBy: "ghid",
    });
    const result = await store.publishableKeys.getActiveByHash("deadbeef");
    expect(result?.app.id).toBe("app_1");
    expect(result?.key.keyHash).toBe("deadbeef");
  });

  it("revoke flips status and getActiveByHash returns null", async () => {
    await store.apps.create({
      id: "app_1",
      apiKeyHash: "h",
      origin: "https://a.com",
      name: "n",
      ownerGithubId: "g",
      originVerifyToken: "t",
      credentialType: "publishable",
    });
    const key = await store.publishableKeys.create({
      appId: "app_1",
      keyHash: "deadbeef",
      createdBy: "ghid",
    });
    await store.publishableKeys.revoke(key.id, "ghid");
    const result = await store.publishableKeys.getActiveByHash("deadbeef");
    expect(result).toBeNull();
  });
});
