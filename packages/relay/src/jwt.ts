import { SignJWT, jwtVerify } from "jose";
import type { ProviderId } from "./providers/types.js";

const ALG = "HS256";
const JWT_VERSION = 2;
const JWT_LIFETIME_SECONDS = 14 * 24 * 60 * 60;

export type SessionClaims = {
  v: number;
  rid: string;
  k: string;
  prov: ProviderId;
  /**
   * Cloud-edition app binding. Present when the JWT was minted in a
   * multi-tenant relay. Cross-tenant JWT replay is blocked by checking
   * this against the resolved tenant's appId at /v1/* and /auth/whoami.
   * Absent in community-edition JWTs.
   */
  app?: string;
  iat: number;
  exp: number;
};

export async function issueSessionJwt(params: {
  recordId: string;
  recordKey: Buffer;
  provider: ProviderId;
  appId?: string;
  secret: Uint8Array;
}): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const payload: Record<string, unknown> = {
    v: JWT_VERSION,
    rid: params.recordId,
    k: params.recordKey.toString("base64url"),
    prov: params.provider,
  };
  // Only emit `app` when present so community-edition JWTs stay
  // byte-identical to pre-multi-tenancy and existing integrations decode
  // them unchanged.
  if (params.appId !== undefined) {
    payload.app = params.appId;
  }
  return await new SignJWT(payload)
    .setProtectedHeader({ alg: ALG })
    .setIssuedAt(now)
    .setExpirationTime(now + JWT_LIFETIME_SECONDS)
    .sign(params.secret);
}

export async function verifySessionJwt(
  token: string,
  secret: Uint8Array,
): Promise<{ recordId: string; recordKey: Buffer; provider: ProviderId; appId?: string }> {
  const { payload } = await jwtVerify(token, secret, { algorithms: [ALG] });
  const claims = payload as Partial<SessionClaims>;
  if (claims.v !== 1 && claims.v !== JWT_VERSION) {
    throw new Error("unsupported jwt version");
  }
  if (typeof claims.rid !== "string" || claims.rid.length === 0) throw new Error("jwt missing rid");
  if (typeof claims.k !== "string" || claims.k.length === 0) throw new Error("jwt missing key");
  const recordKey = Buffer.from(claims.k, "base64url");
  if (recordKey.length !== 32) throw new Error("jwt key has wrong length");
  const provider = (claims.prov ?? "openai") as ProviderId;
  if (provider !== "openai" && provider !== "xai" && provider !== "github") {
    throw new Error(`jwt has unknown provider: ${provider}`);
  }
  const appId = typeof claims.app === "string" && claims.app.length > 0 ? claims.app : undefined;
  return { recordId: claims.rid, recordKey, provider, appId };
}
