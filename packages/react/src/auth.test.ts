import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { signInWithProvider, revokeSession } from "./auth.js";

const originalFetch = globalThis.fetch;
beforeEach(() => { vi.restoreAllMocks(); });
afterEach(() => { globalThis.fetch = originalFetch; });

describe("auth helpers send extraHeaders", () => {
  it("signInWithProvider includes x-authai-publishable-key on /auth/start when provided", async () => {
    const fetchSpy = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({
      sessionId: "s1", provider: "openai", userCode: "ABC",
      verificationUrl: "https://x.com", expiresInMs: 60000, pollIntervalMs: 1000,
    }), { status: 200 }));
    globalThis.fetch = fetchSpy as any;
    const ctrl = new AbortController();
    setTimeout(() => ctrl.abort(), 50);
    await signInWithProvider({
      relayUrl: "https://r.example",
      provider: "openai",
      extraHeaders: { "x-authai-publishable-key": "authai_pk_test" },
      onVerification: () => {},
      signal: ctrl.signal,
    }).catch(() => {}); // ignore the abort error
    expect(fetchSpy).toHaveBeenCalled();
    const [, init] = fetchSpy.mock.calls[0];
    expect((init?.headers as any)?.["x-authai-publishable-key"]).toBe("authai_pk_test");
  });

  it("revokeSession includes extraHeaders + Authorization", async () => {
    const fetchSpy = vi.fn().mockResolvedValueOnce(new Response(null, { status: 204 }));
    globalThis.fetch = fetchSpy as any;
    await revokeSession("https://r.example", "jwt.xyz", {
      "x-authai-publishable-key": "authai_pk_test",
    });
    const [, init] = fetchSpy.mock.calls[0];
    expect((init?.headers as any)?.["x-authai-publishable-key"]).toBe("authai_pk_test");
    expect((init?.headers as any)?.Authorization).toBe("Bearer jwt.xyz");
  });

  it("signInWithProvider works without extraHeaders (backward compat)", async () => {
    const fetchSpy = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({
      sessionId: "s1", provider: "openai", userCode: "ABC",
      verificationUrl: "https://x.com", expiresInMs: 60000, pollIntervalMs: 1000,
    }), { status: 200 }));
    globalThis.fetch = fetchSpy as any;
    const ctrl = new AbortController();
    setTimeout(() => ctrl.abort(), 50);
    await signInWithProvider({
      relayUrl: "https://r.example",
      provider: "openai",
      onVerification: () => {},
      signal: ctrl.signal,
    }).catch(() => {});
    expect(fetchSpy).toHaveBeenCalled();
    const [, init] = fetchSpy.mock.calls[0];
    // x-authai-publishable-key absent when extraHeaders not passed
    expect((init?.headers as any)?.["x-authai-publishable-key"]).toBeUndefined();
  });
});
