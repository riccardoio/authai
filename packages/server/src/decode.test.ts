import { describe, expect, it } from "vitest";
import { SignJWT } from "jose";
import { decodeAuthAIToken } from "./decode.js";

const secret = new TextEncoder().encode("test-secret-not-used-because-decode-does-not-verify");

async function makeJwt(payload: Record<string, unknown>, expSecondsFromNow = 3600): Promise<string> {
  return await new SignJWT(payload)
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(Math.floor(Date.now() / 1000) + expSecondsFromNow)
    .sign(secret);
}

describe("decodeAuthAIToken", () => {
  it("returns provider, expiresAt, appId for a well-formed JWT", async () => {
    const jwt = await makeJwt({
      v: 2,
      rid: "rec_abc",
      k: "AAAA-base64url-key-must-not-leak-AAAA",
      prov: "openai",
      app: "app_xyz",
    });
    const claims = decodeAuthAIToken(jwt);
    expect(claims).not.toBeNull();
    expect(claims!.provider).toBe("openai");
    expect(claims!.appId).toBe("app_xyz");
    expect(claims!.expiresAt).toBeGreaterThan(Math.floor(Date.now() / 1000));
  });

  it("MUST NOT expose the `k` claim (encryption key)", async () => {
    const jwt = await makeJwt({
      v: 2, rid: "r", k: "SECRET-KEY-MATERIAL", prov: "xai",
    });
    const claims = decodeAuthAIToken(jwt) as unknown as Record<string, unknown>;
    // Defense in depth — verify neither the field nor the value leaks.
    expect("k" in claims).toBe(false);
    expect(JSON.stringify(claims)).not.toContain("SECRET-KEY-MATERIAL");
  });

  it("returns null for a malformed JWT", () => {
    expect(decodeAuthAIToken("not.a.jwt")).toBeNull();
    expect(decodeAuthAIToken("")).toBeNull();
    expect(decodeAuthAIToken("only.two")).toBeNull();
  });

  it("returns null for an expired JWT", async () => {
    const jwt = await makeJwt({ v: 2, rid: "r", k: "x", prov: "github" }, -10);
    expect(decodeAuthAIToken(jwt)).toBeNull();
  });

  it("returns null for unknown provider", async () => {
    const jwt = await makeJwt({ v: 2, rid: "r", k: "x", prov: "anthropic" });
    expect(decodeAuthAIToken(jwt)).toBeNull();
  });

  it("appId is null when the JWT has no app claim", async () => {
    const jwt = await makeJwt({ v: 2, rid: "r", k: "x", prov: "openai" });
    const claims = decodeAuthAIToken(jwt);
    expect(claims).not.toBeNull();
    expect(claims!.appId).toBeNull();
  });

  it("returns null for null/undefined input", () => {
    expect(decodeAuthAIToken(null)).toBeNull();
    expect(decodeAuthAIToken(undefined)).toBeNull();
  });
});
