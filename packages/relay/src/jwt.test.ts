import { describe, it, expect } from "vitest";
import { SignJWT } from "jose";
import { issueSessionJwt, verifySessionJwt } from "./jwt.js";
import { generateRecordKey } from "./crypto.js";

const secret = new Uint8Array(32).fill(7);

describe("issueSessionJwt / verifySessionJwt", () => {
  it("round-trips recordId and recordKey", async () => {
    const recordKey = generateRecordKey();
    const recordId = "01HNYZTESTID";
    const jwt = await issueSessionJwt({ recordId, recordKey, secret });
    const verified = await verifySessionJwt(jwt, secret);
    expect(verified.recordId).toBe(recordId);
    expect(verified.recordKey.equals(recordKey)).toBe(true);
  });

  it("fails with the wrong secret", async () => {
    const recordKey = generateRecordKey();
    const jwt = await issueSessionJwt({ recordId: "id", recordKey, secret });
    const wrong = new Uint8Array(32).fill(8);
    await expect(verifySessionJwt(jwt, wrong)).rejects.toThrow();
  });

  it("fails when the signature is tampered", async () => {
    const recordKey = generateRecordKey();
    const jwt = await issueSessionJwt({ recordId: "id", recordKey, secret });
    const parts = jwt.split(".");
    const last = parts[2]!;
    const flipped = (last[0] === "A" ? "B" : "A") + last.slice(1);
    const tampered = `${parts[0]}.${parts[1]}.${flipped}`;
    await expect(verifySessionJwt(tampered, secret)).rejects.toThrow();
  });

  it("rejects an expired token", async () => {
    const recordKey = generateRecordKey();
    const past = Math.floor(Date.now() / 1000) - 60;
    const expired = await new SignJWT({
      v: 1,
      rid: "id",
      k: recordKey.toString("base64url"),
    })
      .setProtectedHeader({ alg: "HS256" })
      .setIssuedAt(past - 100)
      .setExpirationTime(past)
      .sign(secret);
    await expect(verifySessionJwt(expired, secret)).rejects.toThrow();
  });

  it("rejects a jwt with the wrong version", async () => {
    const recordKey = generateRecordKey();
    const future = Math.floor(Date.now() / 1000) + 3600;
    const wrongVersion = await new SignJWT({
      v: 99,
      rid: "id",
      k: recordKey.toString("base64url"),
    })
      .setProtectedHeader({ alg: "HS256" })
      .setIssuedAt(Math.floor(Date.now() / 1000))
      .setExpirationTime(future)
      .sign(secret);
    await expect(verifySessionJwt(wrongVersion, secret)).rejects.toThrow(/version/);
  });

  it("rejects a jwt with a malformed key field", async () => {
    const future = Math.floor(Date.now() / 1000) + 3600;
    const badKey = await new SignJWT({ v: 1, rid: "id", k: "tooshort" })
      .setProtectedHeader({ alg: "HS256" })
      .setIssuedAt(Math.floor(Date.now() / 1000))
      .setExpirationTime(future)
      .sign(secret);
    await expect(verifySessionJwt(badKey, secret)).rejects.toThrow(/length/);
  });

  it("issued JWT has 14-day expiry", async () => {
    const recordKey = generateRecordKey();
    const before = Math.floor(Date.now() / 1000);
    const jwt = await issueSessionJwt({ recordId: "id", recordKey, secret });
    const payload = JSON.parse(Buffer.from(jwt.split(".")[1]!, "base64url").toString("utf-8"));
    const fourteenDays = 14 * 24 * 60 * 60;
    expect(payload.exp - payload.iat).toBe(fourteenDays);
    expect(payload.iat).toBeGreaterThanOrEqual(before);
    expect(payload.v).toBe(1);
  });
});
