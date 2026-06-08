import { beforeEach, describe, expect, it } from "vitest";
import { configureAuthAI } from "./configure.js";
import { getSingletonSnapshot, resetSingletonForTests } from "./singleton.js";

describe("configureAuthAI", () => {
  beforeEach(() => resetSingletonForTests());

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
