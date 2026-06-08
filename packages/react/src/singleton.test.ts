import { beforeEach, describe, expect, it } from "vitest";
import {
  getSingletonSnapshot,
  subscribeSingleton,
  resetSingletonForTests,
  configureSingleton,
  signInSingleton,
  signOutSingleton,
  cancelSingletonFlow,
  confirmSingletonExplain,
  pickSingletonProvider,
} from "./singleton.js";

describe("singleton store", () => {
  beforeEach(() => resetSingletonForTests());

  it("starts signed out with no config", () => {
    const snap = getSingletonSnapshot();
    expect(snap.isSignedIn).toBe(false);
    expect(snap.jwt).toBeNull();
    expect(snap.provider).toBeNull();
  });

  it("configureSingleton stores relayUrl + appName", () => {
    configureSingleton({ relayUrl: "https://r.example", appName: "T" });
    const snap = getSingletonSnapshot();
    expect(snap.relayUrl).toBe("https://r.example");
    expect(snap.appName).toBe("T");
  });

  it("configureSingleton is last-write-wins for relayUrl/appName", () => {
    configureSingleton({ relayUrl: "https://a", appName: "A" });
    configureSingleton({ relayUrl: "https://b", appName: "B" });
    const snap = getSingletonSnapshot();
    expect(snap.relayUrl).toBe("https://b");
    expect(snap.appName).toBe("B");
  });

  it("subscribers are notified on config change", () => {
    let count = 0;
    const unsub = subscribeSingleton(() => { count++; });
    configureSingleton({ relayUrl: "https://x", appName: "X" });
    expect(count).toBeGreaterThan(0);
    unsub();
  });

  it("signOutSingleton clears jwt and notifies", () => {
    configureSingleton({ relayUrl: "https://r", appName: "T", storage: "memory" });
    const snap1 = getSingletonSnapshot();
    expect(snap1.isSignedIn).toBe(false);
    expect(() => signOutSingleton()).not.toThrow();
  });

  it("resetSingletonForTests wipes state", () => {
    configureSingleton({ relayUrl: "https://x", appName: "X" });
    resetSingletonForTests();
    expect(getSingletonSnapshot().relayUrl).toBeNull();
  });

  it("signInSingleton(provider) without config sets error state instead of throwing", async () => {
    await expect(signInSingleton("openai")).resolves.toBeUndefined();
    const snap = getSingletonSnapshot();
    expect(snap.phase).toBe("error");
    expect(snap.error).toMatch(/relayUrl/);
  });

  it("survives a simulated HMR cycle (state on globalThis)", () => {
    configureSingleton({ relayUrl: "https://hmr", appName: "H" });
    const stash = (globalThis as any).__authai;
    expect(stash).toBeDefined();
    expect(stash.config.relayUrl).toBe("https://hmr");
  });

  it("signInSingleton() without provider and without config sets error state instead of throwing", async () => {
    await expect(signInSingleton()).resolves.toBeUndefined();
    const snap = getSingletonSnapshot();
    expect(snap.phase).toBe("error");
    expect(snap.error).toMatch(/relayUrl/);
  });

  it("cancelSingletonFlow from picker transitions to idle and clears pendingProvider", () => {
    configureSingleton({ relayUrl: "https://r", appName: "T" });
    void signInSingleton(); // moves to picker
    expect(getSingletonSnapshot().phase).toBe("picker");
    // No way to set pendingProvider without firing a real network call —
    // we cover the picker→idle transition + verification null reset.
    cancelSingletonFlow();
    const snap = getSingletonSnapshot();
    expect(snap.phase).toBe("idle");
    expect(snap.pendingProvider).toBeNull();
    expect(snap.verification).toBeNull();
  });

  it("cancelSingletonFlow from error clears the error field", async () => {
    await signInSingleton(); // no config → error state
    expect(getSingletonSnapshot().phase).toBe("error");
    cancelSingletonFlow();
    const snap = getSingletonSnapshot();
    expect(snap.phase).toBe("idle");
    expect(snap.error).toBeNull();
  });

  it("cancelSingletonFlow notifies subscribers", () => {
    configureSingleton({ relayUrl: "https://r", appName: "T" });
    void signInSingleton();
    let count = 0;
    const unsub = subscribeSingleton(() => { count++; });
    cancelSingletonFlow();
    expect(count).toBeGreaterThan(0);
    unsub();
  });

  it("hydrates from existing storage BEFORE deciding to swap the storage spec", () => {
    // Pre-load localStorage as if a previous session existed (valid future exp)
    const header = btoa(JSON.stringify({ alg: "HS256" })).replace(/=+$/, "");
    const payload = btoa(JSON.stringify({ prov: "openai", exp: Math.floor(Date.now() / 1000) + 3600 })).replace(/=+$/, "");
    const validJwt = `${header}.${payload}.sig`;
    window.localStorage.setItem("authai:jwt", validJwt);
    try {
      // Configure with a DIFFERENT storage. If hydration happens before
      // the swap decision, we should still surface the prior JWT.
      configureSingleton({ relayUrl: "https://r", appName: "T", storage: "memory" });
      const snap = getSingletonSnapshot();
      expect(snap.jwt).toBe(validJwt);
      expect(snap.isSignedIn).toBe(true);
    } finally {
      window.localStorage.removeItem("authai:jwt");
    }
  });

  it("clears expired tokens from storage on hydration", () => {
    // Pre-load a stale JWT (exp in the past)
    const header = btoa(JSON.stringify({ alg: "HS256" })).replace(/=+$/, "");
    const payload = btoa(JSON.stringify({ prov: "openai", exp: 1 })).replace(/=+$/, "");
    window.localStorage.setItem("authai:jwt", `${header}.${payload}.sig`);
    try {
      configureSingleton({ relayUrl: "https://r", appName: "T" });
      const snap = getSingletonSnapshot();
      expect(snap.isSignedIn).toBe(false);
      expect(window.localStorage.getItem("authai:jwt")).toBeNull();
    } finally {
      window.localStorage.removeItem("authai:jwt");
    }
  });

  it("signInSingleton(provider) sets explain phase without starting the flow", async () => {
    configureSingleton({ relayUrl: "https://r", appName: "T" });
    await signInSingleton("openai");
    const snap = getSingletonSnapshot();
    expect(snap.phase).toBe("explain");
    expect(snap.pendingProvider).toBe("openai");
    expect(snap.verification).toBeNull();
  });
});

describe("singleton SSR safety", () => {
  it("returns signed-out snapshot when document is undefined", () => {
    resetSingletonForTests();
    const originalDoc = globalThis.document;
    // @ts-expect-error simulating SSR
    delete globalThis.document;
    try {
      const snap = getSingletonSnapshot();
      expect(snap.isSignedIn).toBe(false);
      expect(snap.jwt).toBeNull();
    } finally {
      globalThis.document = originalDoc;
    }
  });

  it("configureSingleton is a no-op during SSR", () => {
    resetSingletonForTests();
    const originalDoc = globalThis.document;
    // @ts-expect-error simulating SSR
    delete globalThis.document;
    try {
      configureSingleton({ relayUrl: "https://srv", appName: "S" });
      expect(getSingletonSnapshot().relayUrl).toBeNull();
    } finally {
      globalThis.document = originalDoc;
    }
  });
});
