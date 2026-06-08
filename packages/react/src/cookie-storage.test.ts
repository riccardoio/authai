import { beforeEach, describe, expect, it } from "vitest";
import { cookieAdapter } from "./cookie-storage.js";
import { resolveStorage } from "./storage.js";

function clearAllCookies(): void {
  for (const c of document.cookie.split(";")) {
    const name = c.split("=")[0]?.trim();
    if (name) document.cookie = `${name}=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/`;
  }
}

describe("cookieAdapter", () => {
  beforeEach(() => clearAllCookies());

  it("returns null when no cookie is set", () => {
    expect(cookieAdapter().get()).toBeNull();
  });

  it("writes and reads back a JWT", () => {
    const a = cookieAdapter();
    a.set("eyJ.fake.jwt");
    expect(a.get()).toBe("eyJ.fake.jwt");
  });

  it("clears the cookie", () => {
    const a = cookieAdapter();
    a.set("eyJ.fake.jwt");
    a.clear();
    expect(a.get()).toBeNull();
  });

  it("uses the configured cookie name", () => {
    const a = cookieAdapter({ name: "my-app-jwt" });
    a.set("xyz");
    expect(document.cookie).toContain("my-app-jwt=xyz");
  });

  it("only returns the named cookie, not others", () => {
    document.cookie = "unrelated=hello; path=/";
    const a = cookieAdapter();
    a.set("the-jwt");
    expect(a.get()).toBe("the-jwt");
  });

  it("does not blow up when document is undefined (SSR)", () => {
    const originalDoc = globalThis.document;
    // @ts-expect-error simulating SSR
    delete globalThis.document;
    try {
      const a = cookieAdapter();
      expect(a.get()).toBeNull();
      expect(() => a.set("x")).not.toThrow();
      expect(() => a.clear()).not.toThrow();
    } finally {
      globalThis.document = originalDoc;
    }
  });

  it("auto-enables Secure when sameSite is 'none' (browsers drop SameSite=None without Secure)", () => {
    // jsdom only persists Secure cookies on https origins, so we capture the
    // raw Set-Cookie string via a document.cookie setter spy instead.
    const written: string[] = [];
    const descriptor = Object.getOwnPropertyDescriptor(Document.prototype, "cookie")!;
    const originalSet = descriptor.set!;
    Object.defineProperty(document, "cookie", {
      ...descriptor,
      set(value: string) {
        written.push(value);
        originalSet.call(this, value);
      },
      configurable: true,
    });
    try {
      const a = cookieAdapter({ sameSite: "none", secure: false });
      a.set("xyz");
      // The raw Set-Cookie string written to document.cookie must contain
      // "secure" even though the caller passed secure:false.
      expect(written.some((s) => s.includes("secure"))).toBe(true);
      // And the written value must include our JWT.
      expect(written.some((s) => s.includes("xyz"))).toBe(true);
    } finally {
      Object.defineProperty(document, "cookie", { ...descriptor, configurable: true });
    }
  });
});

describe('resolveStorage("cookie")', () => {
  beforeEach(() => clearAllCookies());

  it("returns a working cookie adapter", () => {
    const a = resolveStorage("cookie");
    a.set("abc");
    expect(a.get()).toBe("abc");
  });
});
