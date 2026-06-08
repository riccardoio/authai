import { describe, it, expect, beforeEach } from "vitest";
import { issueCsrfToken, verifyCsrf, __resetCsrfStateForTests } from "./csrf.js";

describe("CSRF helper", () => {
  beforeEach(() => __resetCsrfStateForTests());

  it("issued token verifies for same session + action", async () => {
    const token = await issueCsrfToken({ sessionCookieValue: "abc", action: "apps.create" });
    expect(await verifyCsrf({ token, sessionCookieValue: "abc", action: "apps.create" })).toBe(true);
  });

  it("rejects token for different session", async () => {
    const token = await issueCsrfToken({ sessionCookieValue: "abc", action: "apps.create" });
    expect(await verifyCsrf({ token, sessionCookieValue: "different", action: "apps.create" })).toBe(false);
  });

  it("rejects token for different action", async () => {
    const token = await issueCsrfToken({ sessionCookieValue: "abc", action: "apps.create" });
    expect(await verifyCsrf({ token, sessionCookieValue: "abc", action: "apps.revoke" })).toBe(false);
  });

  it("rejects reused nonce (one-shot)", async () => {
    const token = await issueCsrfToken({ sessionCookieValue: "abc", action: "apps.create" });
    expect(await verifyCsrf({ token, sessionCookieValue: "abc", action: "apps.create" })).toBe(true);
    expect(await verifyCsrf({ token, sessionCookieValue: "abc", action: "apps.create" })).toBe(false);
  });

  it("rejects garbage token", async () => {
    expect(await verifyCsrf({ token: "not.a.jwt", sessionCookieValue: "abc", action: "x" })).toBe(false);
  });
});
