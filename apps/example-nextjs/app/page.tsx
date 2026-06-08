import { cookies } from "next/headers";
import { decodeAuthAIToken } from "@authai/server";
import { DashboardClient } from "./dashboard-client";

export default async function Page() {
  const cookieStore = await cookies();
  const jwt = cookieStore.get("authai-jwt")?.value ?? null;
  const claims = decodeAuthAIToken(jwt);

  return (
    <main style={{ padding: "2rem", fontFamily: "system-ui" }}>
      <h1>{claims ? "Welcome back" : "AuthAI + Next.js"}</h1>
      {claims ? (
        <p>
          Signed in via <strong>{claims.provider}</strong>. Token expires at{" "}
          {new Date(claims.expiresAt * 1000).toLocaleString()}.
        </p>
      ) : (
        <p>Sign in with your AI subscription.</p>
      )}
      <DashboardClient />
    </main>
  );
}
