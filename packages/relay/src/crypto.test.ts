import { describe, it, expect } from "vitest";
import { decryptJson, encryptJson, generateRecordKey, sha256Hex } from "./crypto.js";

describe("generateRecordKey", () => {
  it("returns 32 random bytes", () => {
    const k1 = generateRecordKey();
    const k2 = generateRecordKey();
    expect(k1.length).toBe(32);
    expect(k2.length).toBe(32);
    expect(k1.equals(k2)).toBe(false);
  });
});

describe("encryptJson / decryptJson", () => {
  it("round-trips primitives, objects, and arrays", () => {
    const key = generateRecordKey();
    const cases: unknown[] = [
      { access: "tok-123", refresh: "r-456", expires: 1733000000000, accountId: "acct_x" },
      "plain string",
      [1, 2, 3, "four", { nested: true }],
      { unicode: "💀🔐", nested: { a: null, b: false } },
    ];
    for (const original of cases) {
      const enc = encryptJson(key, original);
      expect(enc.iv.length).toBe(12);
      expect(enc.blob.length).toBeGreaterThan(16);
      expect(decryptJson(key, enc)).toEqual(original);
    }
  });

  it("uses a fresh IV per encryption (random nonces)", () => {
    const key = generateRecordKey();
    const value = { x: 1 };
    const a = encryptJson(key, value);
    const b = encryptJson(key, value);
    expect(Buffer.from(a.iv).equals(Buffer.from(b.iv))).toBe(false);
    expect(Buffer.from(a.blob).equals(Buffer.from(b.blob))).toBe(false);
  });

  it("decrypt with a different key fails", () => {
    const k1 = generateRecordKey();
    const k2 = generateRecordKey();
    const enc = encryptJson(k1, { x: 1 });
    expect(() => decryptJson(k2, enc)).toThrow();
  });

  it("tampered ciphertext fails GCM auth", () => {
    const key = generateRecordKey();
    const enc = encryptJson(key, { x: 1 });
    const tampered = new Uint8Array(enc.blob);
    tampered[0] ^= 0xff;
    expect(() => decryptJson(key, { iv: enc.iv, blob: tampered })).toThrow();
  });

  it("tampered IV fails GCM auth", () => {
    const key = generateRecordKey();
    const enc = encryptJson(key, { x: 1 });
    const badIv = new Uint8Array(enc.iv);
    badIv[0] ^= 0xff;
    expect(() => decryptJson(key, { iv: badIv, blob: enc.blob })).toThrow();
  });

  it("rejects keys of wrong length", () => {
    const short = Buffer.alloc(16);
    expect(() => encryptJson(short, { x: 1 })).toThrow(/32 bytes/);
    expect(() => decryptJson(short, { iv: new Uint8Array(12), blob: new Uint8Array(32) })).toThrow(/32 bytes/);
  });

  it("rejects truncated ciphertext", () => {
    const key = generateRecordKey();
    expect(() =>
      decryptJson(key, { iv: new Uint8Array(12), blob: new Uint8Array(8) }),
    ).toThrow(/auth tag/);
  });
});

describe("sha256Hex", () => {
  it("is deterministic and matches the known SHA-256 of 'hello'", () => {
    expect(sha256Hex("hello")).toBe(
      "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824",
    );
    expect(sha256Hex("hello")).toBe(sha256Hex("hello"));
    expect(sha256Hex("hello")).not.toBe(sha256Hex("Hello"));
  });
});
