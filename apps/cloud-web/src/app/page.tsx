import { getSession } from "@/lib/session";
import { LandingClient } from "./landing-client";

/**
 * Landing page at authai.io. Server Component — fetches the builder
 * session (HttpOnly cookie, not visible to client JS) so the topbar
 * can render the signed-in variant (@login + Manage apps) without
 * a client-side roundtrip or layout flash. When signed out, session
 * is null and the public marketing nav renders.
 *
 * Session shape passed to the client is intentionally narrow: only
 * the GitHub login is needed by the topbar UI, so we don't leak the
 * id or email through the props payload.
 */
export default async function HomePage() {
  const session = await getSession();
  return (
    <LandingClient
      session={session ? { githubLogin: session.githubLogin } : null}
    />
  );
}
