import { SignJWT, jwtVerify } from "jose";

/**
 * Admin-side authentication for the `/admin/*` API.
 *
 * Flow:
 *   1. Builder runs `npx authai-cloud init` → CLI does GitHub device-code
 *      OAuth → CLI presents the GitHub access_token to `/admin/login`.
 *   2. `/admin/login` exchanges the GitHub token for an admin session JWT
 *      (signed by the relay) that the CLI then uses for subsequent admin
 *      calls.
 *   3. The admin JWT carries the GitHub user id + login + email so app
 *      creation can attribute ownership without re-querying GitHub on
 *      every request.
 *
 * Note: the admin auth path is COMPLETELY SEPARATE from the user-facing
 * session JWT minted by the regular relay flow. Different secret, different
 * shape, different lifetime, different audience.
 */

const ALG = "HS256";
const ADMIN_JWT_VERSION = 1;
const ADMIN_JWT_LIFETIME_SECONDS = 24 * 60 * 60; // 24h — re-auth daily.

export type AdminClaims = {
  v: number;
  sub: string; // github user id
  login: string; // github login
  email?: string;
  iat: number;
  exp: number;
};

export async function issueAdminJwt(params: {
  githubUserId: string;
  githubLogin: string;
  githubEmail?: string;
  secret: Uint8Array;
}): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const payload: Record<string, unknown> = {
    v: ADMIN_JWT_VERSION,
    sub: params.githubUserId,
    login: params.githubLogin,
  };
  if (params.githubEmail) payload.email = params.githubEmail;
  return await new SignJWT(payload)
    .setProtectedHeader({ alg: ALG })
    .setIssuedAt(now)
    .setExpirationTime(now + ADMIN_JWT_LIFETIME_SECONDS)
    .sign(params.secret);
}

export async function verifyAdminJwt(
  token: string,
  secret: Uint8Array,
): Promise<{ githubUserId: string; githubLogin: string; githubEmail?: string }> {
  const { payload } = await jwtVerify(token, secret, { algorithms: [ALG] });
  const claims = payload as Partial<AdminClaims>;
  if (claims.v !== ADMIN_JWT_VERSION) throw new Error("unsupported admin jwt version");
  if (typeof claims.sub !== "string" || !claims.sub) throw new Error("admin jwt missing sub");
  if (typeof claims.login !== "string" || !claims.login) throw new Error("admin jwt missing login");
  return {
    githubUserId: claims.sub,
    githubLogin: claims.login,
    githubEmail: typeof claims.email === "string" ? claims.email : undefined,
  };
}

/**
 * Exchange a GitHub access token for the user's profile. Used by the
 * /admin/login endpoint to verify a builder's identity before issuing the
 * admin JWT.
 *
 * The relay does NOT store the GitHub token — it's only used to fetch
 * the user once and then discarded. The CLI flow ensures the token has
 * `read:user` scope minimum.
 */
export async function fetchGithubUser(
  accessToken: string,
): Promise<{ id: string; login: string; email?: string }> {
  const res = await fetch("https://api.github.com/user", {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: "application/vnd.github+json",
      "User-Agent": "authai-cloud",
    },
  });
  if (!res.ok) {
    throw new Error(`github returned ${res.status}`);
  }
  const data = (await res.json()) as { id: number; login: string; email?: string | null };
  return {
    id: String(data.id),
    login: data.login,
    email: data.email ?? undefined,
  };
}
