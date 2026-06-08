import { beforeEach, describe, expect, it, vi } from "vitest";
import { configureAuthAI, __resetConfigureWarnedForTests } from "./configure.js";
import { getSingletonSnapshot, resetSingletonForTests } from "./singleton.js";

describe("configureAuthAI", () => {
  beforeEach(() => { resetSingletonForTests(); __resetConfigureWarnedForTests(); });

  it("writes relayUrl and appName to the singleton", () => {
    configureAuthAI({ relayUrl: "https://r", appName: "X" });
    const snap = getSingletonSnapshot();
    expect(snap.relayUrl).toBe("https://r");
    expect(snap.appName).toBe("X");
  });

  it("is idempotent — calling twice with same values is fine", () => {
    configureAuthAI({ relayUrl: "https://r", appName: "X" });
    configureAuthAI({ relayUrl: "https://r", appName: "X" });
    expect(getSingletonSnapshot().relayUrl).toBe("https://r");
  });

  it("last write wins for relayUrl", () => {
    configureAuthAI({ relayUrl: "https://a", appName: "X" });
    configureAuthAI({ relayUrl: "https://b", appName: "X" });
    expect(getSingletonSnapshot().relayUrl).toBe("https://b");
  });

  it("is a no-op when document is undefined (SSR)", () => {
    const originalDoc = globalThis.document;
    // @ts-expect-error simulating SSR
    delete globalThis.document;
    try {
      configureAuthAI({ relayUrl: "https://srv", appName: "S" });
      expect(getSingletonSnapshot().relayUrl).toBeNull();
    } finally {
      globalThis.document = originalDoc;
    }
  });
});

describe("configureAuthAI appId (Task 3.2)", () => {
  beforeEach(() => { resetSingletonForTests(); __resetConfigureWarnedForTests(); });

  it("appId is null by default", () => {
    configureAuthAI({ relayUrl: "https://r", appName: "X" });
    expect(getSingletonSnapshot().appId).toBeNull();
  });

  it("appId populates the snapshot", () => {
    configureAuthAI({ relayUrl: "https://r", appName: "X", appId: "authai_pk_x" });
    expect(getSingletonSnapshot().appId).toBe("authai_pk_x");
  });

  it("dev-mode warning fires for prod relay + appId + non-prod env", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const originalEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = "development";
    try {
      configureAuthAI({
        relayUrl: "https://relay.authai.io",
        appName: "X", appId: "authai_pk_x",
      });
      expect(warn).toHaveBeenCalled();
      expect(warn.mock.calls[0][0]).toContain("browser-direct mode");
    } finally {
      process.env.NODE_ENV = originalEnv;
      warn.mockRestore();
    }
  });

  it("dev-mode warning silent in production builds", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const originalEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = "production";
    try {
      configureAuthAI({
        relayUrl: "https://relay.authai.io",
        appName: "X", appId: "authai_pk_x",
      });
      expect(warn).not.toHaveBeenCalled();
    } finally {
      process.env.NODE_ENV = originalEnv;
      warn.mockRestore();
    }
  });

  it("dev-mode warning silent for non-cloud relayUrl", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const originalEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = "development";
    try {
      configureAuthAI({ relayUrl: "https://my-own-relay.com", appName: "X", appId: "authai_pk_x" });
      expect(warn).not.toHaveBeenCalled();
    } finally {
      process.env.NODE_ENV = originalEnv;
      warn.mockRestore();
    }
  });
});
