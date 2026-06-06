import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { stream } from "hono/streaming";
import OpenAI from "openai";

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

app.post("/chat", async (c) => {
  const auth = c.req.header("Authorization") || "";
  const match = auth.match(/^Bearer\s+(.+)$/i);
  if (!match) return c.json({ error: "missing bearer token" }, 401);
  const jwt = match[1]!;

  let body: any;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "invalid json" }, 400);
  }
  if (typeof body?.model !== "string" || !Array.isArray(body?.messages)) {
    return c.json({ error: "model and messages required" }, 400);
  }

  const openai = new OpenAI({
    apiKey: jwt,
    baseURL: `${RELAY_URL}/v1`,
  });

  try {
    const completion = await openai.chat.completions.create({
      model: body.model,
      messages: body.messages,
      stream: true,
    });
    c.header("Content-Type", "text/plain; charset=utf-8");
    return stream(c, async (s) => {
      for await (const chunk of completion) {
        const delta = chunk.choices[0]?.delta?.content;
        if (delta) await s.write(new TextEncoder().encode(delta));
      }
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return c.json({ error: message }, 502);
  }
});

serve({ fetch: app.fetch, port: PORT }, (info) => {
  console.log(`example-backend listening on http://localhost:${info.port}`);
  console.log(`  using relay at ${RELAY_URL}`);
});
