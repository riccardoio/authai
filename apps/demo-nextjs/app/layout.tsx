import { cookies } from "next/headers";
import { AuthAIProvider } from "@authai-io/react";

const RELAY_URL = process.env.NEXT_PUBLIC_AUTHAI_RELAY_URL ?? "https://relay.authai.io";

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const cookieStore = await cookies();
  const jwt = cookieStore.get("authai-jwt")?.value ?? null;
  return (
    <html lang="en">
      <body>
        <AuthAIProvider
          relayUrl={RELAY_URL}
          appName="AuthAI Next.js Demo"
          initialJwt={jwt}
          storage="cookie"
        >
          {children}
        </AuthAIProvider>
      </body>
    </html>
  );
}
