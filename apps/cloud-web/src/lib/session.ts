/**
 * Webapp session: a short-lived JWT stored in an HttpOnly cookie that
 * binds the browser tab to a GitHub identity. Created at the OAuth
 * callback, read by every authenticated route, cleared at sign-out.
 *
 * This has no relationship to the relay's session JWT (different secret,
 * different audience, different lifetime). The webapp never sees a
 * relay-issued JWT.
 */

import { SignJWT, jwtVerify } from "jose";
import { cookies } from "next/headers";
import { SESSION_SECRET_HEX } from "./env";

const COOKIE_NAME = "authai_cloud_session";
const LIFETIME_SECONDS = 7 * 24 * 60 * 60; // 7 days.

function secret(): Uint8Array {
  if (!SESSION_SECRET_HEX || SESSION_SECRET_HEX.length < 64) {
    throw new Error(
      "AUTH_AI_CLOUD_WEB_SESSION_SECRET missing or too short " +
        "(need 32 bytes hex / 64 chars)",
    );
  }
  return new Uint8Array(Buffer.from(SESSION_SECRET_HEX, "hex"));
}

export type Session = {
  githubUserId: string;
  githubLogin: string;
  githubEmail?: string;
};

export async function createSession(profile: Session): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  return await new SignJWT({
    sub: profile.githubUserId,
    login: profile.githubLogin,
    email: profile.githubEmail,
  })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt(now)
    .setExpirationTime(now + LIFETIME_SECONDS)
    .sign(secret());
}

export async function readSession(token: string | undefined): Promise<Session | null> {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, secret(), { algorithms: ["HS256"] });
    return {
      githubUserId: payload.sub as string,
      githubLogin: payload.login as string,
      githubEmail: typeof payload.email === "string" ? payload.email : undefined,
    };
  } catch {
    return null;
  }
}

export async function getSession(): Promise<Session | null> {
  const c = await cookies();
  const token = c.get(COOKIE_NAME)?.value;
  return readSession(token);
}

export async function setSessionCookie(token: string): Promise<void> {
  const c = await cookies();
  c.set(COOKIE_NAME, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: LIFETIME_SECONDS,
  });
}

export async function clearSessionCookie(): Promise<void> {
  const c = await cookies();
  c.delete(COOKIE_NAME);
}

export { COOKIE_NAME as SESSION_COOKIE };
export const SESSION_COOKIE_NAME = COOKIE_NAME;
