import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { stream } from "hono/streaming";
import { AuthAIUnauthorized, authai } from "@authai/server";

const RELAY_URL = process.env.AUTH_AI_RELAY_URL ?? "http://localhost:3000";
const PORT = Number(process.env.PORT ?? 4000);

const app = new Hono();

app.use("*", async (c, next) => {
  c.header("Access-Control-Allow-Origin", "*");
  c.header("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  c.header("Access-Control-Allow-Headers", "Content-Type, Authorization");
  if (c.req.method === "OPTIONS") return c.body(null, 204);
  await next();
});

app.get("/", (c) => c.json({ ok: true, service: "example-backend", relay: RELAY_URL }));

function extractJwt(authHeader: string | undefined): string | null {
  if (!authHeader) return null;
  const match = authHeader.match(/^Bearer\s+(.+)$/i);
  return match ? match[1]! : null;
}

app.get("/me", async (c) => {
  const jwt = extractJwt(c.req.header("Authorization"));
  try {
    const { user, session } = await authai.session({ jwt, relayUrl: RELAY_URL });
    return c.json({ user, session });
  } catch (err) {
    if (err instanceof AuthAIUnauthorized) return c.json({ error: "unauthorized" }, 401);
    return c.json({ error: err instanceof Error ? err.message : String(err) }, 502);
  }
});

app.get("/models", async (c) => {
  const jwt = extractJwt(c.req.header("Authorization"));
  try {
    const { openai } = await authai.session({ jwt, relayUrl: RELAY_URL });
    if (!openai) return c.json({ error: "openai SDK not installed on the backend" }, 500);
    const list = await openai.models.list();
    return c.json({ data: list.data.map((m: any) => ({ id: m.id, owned_by: m.owned_by })) });
  } catch (err) {
    if (err instanceof AuthAIUnauthorized) return c.json({ error: "unauthorized" }, 401);
    return c.json({ error: err instanceof Error ? err.message : String(err) }, 502);
  }
});

app.post("/chat", async (c) => {
  const jwt = extractJwt(c.req.header("Authorization"));
  let body: any;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "invalid json" }, 400);
  }
  if (typeof body?.model !== "string" || !Array.isArray(body?.messages)) {
    return c.json({ error: "model and messages required" }, 400);
  }

  try {
    const { user, openai } = await authai.session({ jwt, relayUrl: RELAY_URL });
    if (!openai) return c.json({ error: "openai SDK not installed on the backend" }, 500);
    console.log(`[chat] user=${user.id.slice(0, 8)}… provider=${user.provider} model=${body.model}`);
    const completion = await openai.chat.completions.create({
      model: body.model,
      messages: body.messages,
      stream: true,
    });
    c.header("Content-Type", "text/plain; charset=utf-8");
    return stream(c, async (s) => {
      for await (const chunk of completion as any) {
        const delta = chunk?.choices?.[0]?.delta?.content;
        if (delta) await s.write(new TextEncoder().encode(delta));
      }
    });
  } catch (err) {
    if (err instanceof AuthAIUnauthorized) return c.json({ error: "unauthorized" }, 401);
    return c.json({ error: err instanceof Error ? err.message : String(err) }, 502);
  }
});

serve({ fetch: app.fetch, port: PORT }, (info) => {
  console.log(`example-backend listening on http://localhost:${info.port}`);
  console.log(`  using relay at ${RELAY_URL}`);
});
