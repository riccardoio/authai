import { cookies } from "next/headers";
import { decodeAuthAIToken } from "@authai/server";
import { DashboardClient } from "./dashboard-client";

export default async function Page() {
  const cookieStore = await cookies();
  const jwt = cookieStore.get("authai-jwt")?.value ?? null;
  const claims = decodeAuthAIToken(jwt);

  if (!claims) {
    // Signed-out shell is server-rendered. The sign-in dialog is
    // client-only; the provider's <SignIn> button triggers it.
    return (
      <main style={{ padding: "2rem", fontFamily: "system-ui" }}>
        <h1>AuthAI + Next.js</h1>
        <p>Sign in with your AI subscription.</p>
        <DashboardClient signedIn={false} />
      </main>
    );
  }

  return (
    <main style={{ padding: "2rem", fontFamily: "system-ui" }}>
      <h1>Welcome back</h1>
      <p>
        Signed in via <strong>{claims.provider}</strong>. Token expires at{" "}
        {new Date(claims.expiresAt * 1000).toLocaleString()}.
      </p>
      <DashboardClient signedIn={true} />
    </main>
  );
}
