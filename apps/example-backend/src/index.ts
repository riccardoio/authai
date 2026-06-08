import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { Hono } from "hono";
import { stream } from "hono/streaming";
import { AuthAIUnauthorized, authai } from "@authai/server";
import { readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const RELAY_URL = process.env.AUTH_AI_RELAY_URL ?? "http://localhost:3000";
const AUTH_AI_SECRET = process.env.AUTH_AI_SECRET;
const PORT = Number(process.env.PORT ?? 4000);

// Where the built SPA lives. In the Docker image we COPY example-react/dist
// next to the backend's source; locally pnpm dev keeps the SPA on its own
// Vite dev server (5173) so this path is only used in prod-style runs.
const __dirname = dirname(fileURLToPath(import.meta.url));
const SPA_DIST = resolve(__dirname, "../public");

const app = new Hono();

app.use("/api/*", async (c, next) => {
  // Tight CORS for the API surface only — same-origin in prod, permissive
  // for local Vite dev. Static SPA serving doesn't need CORS at all.
  c.header("Access-Control-Allow-Origin", "*");
  c.header("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  c.header("Access-Control-Allow-Headers", "Content-Type, Authorization");
  if (c.req.method === "OPTIONS") return c.body(null, 204);
  await next();
});

app.get("/healthz", (c) =>
  c.json({ ok: true, service: "authai-demo", relay: RELAY_URL }),
);

function extractJwt(authHeader: string | undefined): string | null {
  if (!authHeader) return null;
  const match = authHeader.match(/^Bearer\s+(.+)$/i);
  return match ? match[1]! : null;
}

app.get("/api/me", async (c) => {
  const jwt = extractJwt(c.req.header("Authorization"));
  try {
    const { user, session } = await authai.session({
      jwt,
      relayUrl: RELAY_URL,
      secret: AUTH_AI_SECRET,
    });
    return c.json({ user, session });
  } catch (err) {
    if (err instanceof AuthAIUnauthorized) return c.json({ error: "unauthorized" }, 401);
    return c.json({ error: err instanceof Error ? err.message : String(err) }, 502);
  }
});

app.get("/api/models", async (c) => {
  const jwt = extractJwt(c.req.header("Authorization"));
  try {
    const { openai } = await authai.session({
      jwt,
      relayUrl: RELAY_URL,
      secret: AUTH_AI_SECRET,
    });
    if (!openai) return c.json({ error: "openai SDK not installed on the backend" }, 500);
    const list = await openai.models.list();
    return c.json({ data: list.data.map((m: any) => ({ id: m.id, owned_by: m.owned_by })) });
  } catch (err) {
    if (err instanceof AuthAIUnauthorized) return c.json({ error: "unauthorized" }, 401);
    return c.json({ error: err instanceof Error ? err.message : String(err) }, 502);
  }
});

app.post("/api/chat", async (c) => {
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
    const { user, openai } = await authai.session({
      jwt,
      relayUrl: RELAY_URL,
      secret: AUTH_AI_SECRET,
    });
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

// Static SPA — served only when the dist exists (i.e. the prod Docker image).
// Local dev runs the Vite server separately on 5173 and proxies /api/* here.
app.use("/assets/*", serveStatic({ root: relativeToCwd(SPA_DIST) }));
app.get("/favicon.ico", serveStatic({ root: relativeToCwd(SPA_DIST) }));
app.get("/vite.svg", serveStatic({ root: relativeToCwd(SPA_DIST) }));

// SPA fallback — anything that didn't match a route or asset gets index.html
// so client-side routing works. /api/* and /healthz are already handled above.
app.get("*", async (c) => {
  try {
    const html = await readFile(join(SPA_DIST, "index.html"), "utf8");
    return c.html(html);
  } catch {
    return c.text(
      "SPA bundle not found. Run `pnpm --filter example-react build` first, or use the Vite dev server.",
      503,
    );
  }
});

function relativeToCwd(absolute: string): string {
  // hono's serveStatic resolves `root` against process.cwd(). Convert our
  // absolute SPA_DIST to a relative path so it works regardless of where
  // the process is launched from (local pnpm vs. Docker WORKDIR).
  const rel = absolute.startsWith(process.cwd())
    ? absolute.slice(process.cwd().length + 1)
    : absolute;
  return rel || ".";
}

serve({ fetch: app.fetch, port: PORT }, (info) => {
  console.log(`authai-demo listening on http://localhost:${info.port}`);
  console.log(`  relay: ${RELAY_URL}`);
  console.log(`  spa dist: ${SPA_DIST}`);
  if (!AUTH_AI_SECRET) {
    console.warn("  ⚠️  AUTH_AI_SECRET not set — relay calls will 401 on cloud");
  }
});
