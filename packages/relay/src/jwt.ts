import { SignJWT, jwtVerify } from "jose";

const ALG = "HS256";
const JWT_VERSION = 1;
const JWT_LIFETIME_SECONDS = 14 * 24 * 60 * 60;

export type SessionClaims = {
  v: number;
  rid: string;
  k: string;
  iat: number;
  exp: number;
};

export async function issueSessionJwt(params: {
  recordId: string;
  recordKey: Buffer;
  secret: Uint8Array;
}): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  return await new SignJWT({
    v: JWT_VERSION,
    rid: params.recordId,
    k: params.recordKey.toString("base64url"),
  })
    .setProtectedHeader({ alg: ALG })
    .setIssuedAt(now)
    .setExpirationTime(now + JWT_LIFETIME_SECONDS)
    .sign(params.secret);
}

export async function verifySessionJwt(
  token: string,
  secret: Uint8Array,
): Promise<{ recordId: string; recordKey: Buffer }> {
  const { payload } = await jwtVerify(token, secret, { algorithms: [ALG] });
  const claims = payload as Partial<SessionClaims>;
  if (claims.v !== JWT_VERSION) throw new Error("unsupported jwt version");
  if (typeof claims.rid !== "string" || claims.rid.length === 0) throw new Error("jwt missing rid");
  if (typeof claims.k !== "string" || claims.k.length === 0) throw new Error("jwt missing key");
  const recordKey = Buffer.from(claims.k, "base64url");
  if (recordKey.length !== 32) throw new Error("jwt key has wrong length");
  return { recordId: claims.rid, recordKey };
}
