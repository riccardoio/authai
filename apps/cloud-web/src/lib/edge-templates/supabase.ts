/**
 * Generates a Supabase Edge Function that proxies the AuthAI relay.
 *
 * SECURITY INVARIANTS (pinned by snapshot tests):
 *   - CORS Access-Control-Allow-Origin = configured app origin only (never "*")
 *   - 1MB body size cap with 413 response on overflow
 *   - Authorization: Bearer header required (401 without)
 *   - No logging of the bearer JWT, the secret env var, or response bodies
 *   - Secret passed via x-authai-secret header (server-side only)
 *
 * Adding a new template? Mirror the same invariants + add a snapshot test.
 * The CODEOWNERS gate (Phase 9) protects this file.
 */
export function renderSupabaseEdgeTemplate(opts: {
  appName: string;
  secretEnvVar: string;
  relayUrl: string;
  allowedOrigin: string;
}): string {
  return `// SECURITY: this template enforces the AuthAI proxy invariants.
//   1. CORS Access-Control-Allow-Origin is pinned to a single origin — NEVER set to "*".
//   2. The AUTH_AI_SECRET stays server-side; sent to the relay via the
//      x-authai-secret header. NEVER logged.
//   3. Body size is capped at MAX_BODY_BYTES to prevent abuse.
//   4. Authorization: Bearer <jwt> from the client is required.
//      Without it, the function returns 401 immediately.
//
// Deploy: supabase functions deploy chat --project-ref <your-project>
// Env:    supabase secrets set ${opts.secretEnvVar}=<your-authai-secret>

import "https://deno.land/x/xhr@0.1.0/mod.ts";

const RELAY_URL = ${JSON.stringify(opts.relayUrl)};
const ALLOWED_ORIGIN = ${JSON.stringify(opts.allowedOrigin)};
const MAX_BODY_BYTES = 1 * 1024 * 1024;

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": ${JSON.stringify(opts.allowedOrigin)},
  "Access-Control-Allow-Headers": "authorization, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405, headers: CORS_HEADERS });
  }

  const authHeader = req.headers.get("authorization");
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return new Response(JSON.stringify({ error: "unauthorized" }), {
      status: 401,
      headers: { ...CORS_HEADERS, "content-type": "application/json" },
    });
  }

  const contentLength = req.headers.get("content-length");
  if (contentLength && Number(contentLength) > MAX_BODY_BYTES) {
    return new Response("Payload too large", { status: 413, headers: CORS_HEADERS });
  }

  const body = await req.text();
  if (body.length > MAX_BODY_BYTES) {
    return new Response("Payload too large", { status: 413, headers: CORS_HEADERS });
  }

  const secret = Deno.env.get(${JSON.stringify(opts.secretEnvVar)});
  if (!secret) {
    console.error("Edge function misconfigured: missing secret env var");
    return new Response("Server misconfigured", { status: 500, headers: CORS_HEADERS });
  }

  const relayResponse = await fetch(\`\${RELAY_URL}/v1/chat/completions\`, {
    method: "POST",
    headers: {
      "authorization": authHeader,
      "x-authai-secret": secret,
      "content-type": "application/json",
    },
    body,
  });

  return new Response(relayResponse.body, {
    status: relayResponse.status,
    headers: {
      ...CORS_HEADERS,
      "content-type": relayResponse.headers.get("content-type") ?? "application/json",
    },
  });
});
`;
}
