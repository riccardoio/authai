import { randomBytes, createHash, createCipheriv, createDecipheriv } from "node:crypto";

const ALG = "aes-256-gcm";
const KEY_LEN = 32;
const IV_LEN = 12;

export type EncryptedPayload = {
  iv: Uint8Array;
  blob: Uint8Array;
};

export function generateRecordKey(): Buffer {
  return randomBytes(KEY_LEN);
}

export function encryptJson(key: Buffer, value: unknown): EncryptedPayload {
  if (key.length !== KEY_LEN) {
    throw new Error(`record key must be ${KEY_LEN} bytes, got ${key.length}`);
  }
  const iv = randomBytes(IV_LEN);
  const cipher = createCipheriv(ALG, key, iv);
  const plaintext = Buffer.from(JSON.stringify(value), "utf-8");
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();
  return { iv: new Uint8Array(iv), blob: new Uint8Array(Buffer.concat([ciphertext, tag])) };
}

export function decryptJson<T = unknown>(key: Buffer, payload: EncryptedPayload): T {
  if (key.length !== KEY_LEN) {
    throw new Error(`record key must be ${KEY_LEN} bytes, got ${key.length}`);
  }
  if (payload.blob.length < 16) {
    throw new Error("ciphertext too short to contain auth tag");
  }
  const blob = Buffer.from(payload.blob);
  const ciphertext = blob.subarray(0, blob.length - 16);
  const tag = blob.subarray(blob.length - 16);
  const decipher = createDecipheriv(ALG, key, Buffer.from(payload.iv));
  decipher.setAuthTag(tag);
  const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  return JSON.parse(plaintext.toString("utf-8")) as T;
}

export function sha256Hex(input: string): string {
  return createHash("sha256").update(input, "utf-8").digest("hex");
}
