import { Hono } from "hono";
import { stream } from "hono/streaming";
import { callCodexResponses, SUPPORTED_CODEX_MODELS } from "./codex-client.js";
import {
  chatRequestToCodexResponses,
  codexStreamToChatChunks,
  codexStreamToCompletion,
  encodeSseChunk,
  encodeSseDone,
} from "./openai-translate.js";
import { loadAndMaybeRefresh } from "./refresh.js";
import type { AuthRecordStore } from "./store.js";
import { verifySessionJwt } from "./jwt.js";

export function createV1Routes(deps: {
  store: AuthRecordStore;
  jwtSecret: Uint8Array;
}): Hono {
  const app = new Hono();

  app.use("*", async (c, next) => {
    if (c.req.method === "OPTIONS") return next();
    const auth = c.req.header("Authorization") || "";
    const match = auth.match(/^Bearer\s+(.+)$/i);
    if (!match) return openaiError(c, 401, "missing bearer token", "invalid_request_error");
    try {
      const verified = await verifySessionJwt(match[1]!, deps.jwtSecret);
      c.set("recordId", verified.recordId);
      c.set("recordKey", verified.recordKey);
    } catch (err) {
      return openaiError(c, 401, `invalid token: ${(err as Error).message}`, "invalid_request_error");
    }
    return next();
  });

  app.get("/models", (c) => {
    const created = Math.floor(Date.now() / 1000);
    return c.json({
      object: "list",
      data: SUPPORTED_CODEX_MODELS.map((id) => ({
        id,
        object: "model",
        created,
        owned_by: "openai-codex",
      })),
    });
  });

  app.post("/chat/completions", async (c) => {
    let body: any;
    try {
      body = await c.req.json();
    } catch {
      return openaiError(c, 400, "invalid json body", "invalid_request_error");
    }
    if (!body || typeof body.model !== "string" || !Array.isArray(body.messages)) {
      return openaiError(c, 400, "model and messages are required", "invalid_request_error");
    }

    const credentials = await resolveCredentials(c, deps.store);
    if ("error" in credentials) return credentials.error;

    const codexBody = chatRequestToCodexResponses(body);
    const result = await callCodexResponses({
      credentials: { access: credentials.access, accountId: credentials.accountId },
      body: codexBody,
    });

    if (!result.ok || !result.body) {
      return c.json(safeJsonParse(result.text) ?? { error: { message: result.text || "codex error", type: "codex_error" } }, result.status as 400);
    }

    const wantsStream = body.stream === true;
    if (!wantsStream) {
      const completion = await codexStreamToCompletion(result.body, body.model);
      return c.json(completion);
    }

    c.header("Content-Type", "text/event-stream");
    c.header("Cache-Control", "no-cache");
    c.header("Connection", "keep-alive");
    return stream(c, async (s) => {
      for await (const ev of codexStreamToChatChunks(result.body!, body.model)) {
        if ("type" in ev && ev.type === "done") {
          await s.write(encodeSseDone());
          return;
        }
        await s.write(encodeSseChunk(ev as any));
      }
      await s.write(encodeSseDone());
    });
  });

  app.post("/responses", async (c) => {
    let body: any;
    try {
      body = await c.req.json();
    } catch {
      return openaiError(c, 400, "invalid json body", "invalid_request_error");
    }

    const credentials = await resolveCredentials(c, deps.store);
    if ("error" in credentials) return credentials.error;

    const result = await callCodexResponses({
      credentials: { access: credentials.access, accountId: credentials.accountId },
      body,
    });
    if (!result.ok || !result.body) {
      return c.json(safeJsonParse(result.text) ?? { error: { message: result.text || "codex error", type: "codex_error" } }, result.status as 400);
    }

    c.header("Content-Type", "text/event-stream");
    c.header("Cache-Control", "no-cache");
    c.header("Connection", "keep-alive");
    return stream(c, async (s) => {
      const reader = result.body!.getReader();
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        await s.write(value);
      }
    });
  });

  app.all("*", (c) => {
    return openaiError(
      c,
      400,
      `Endpoint ${c.req.path} not supported by Codex auth`,
      "unsupported_endpoint",
    );
  });

  return app;
}

async function resolveCredentials(
  c: any,
  store: AuthRecordStore,
): Promise<{ access: string; accountId: string } | { error: Response }> {
  const recordId = c.get("recordId") as string;
  const recordKey = c.get("recordKey") as Buffer;
  const record = await store.get(recordId);
  if (!record) {
    return { error: openaiError(c, 401, "session not found or revoked", "invalid_request_error") };
  }
  try {
    const tokens = await loadAndMaybeRefresh({ store, record, recordKey });
    return { access: tokens.access, accountId: tokens.accountId };
  } catch (err) {
    return {
      error: openaiError(c, 401, `cannot resolve session: ${(err as Error).message}`, "invalid_request_error"),
    };
  }
}

function openaiError(c: any, status: number, message: string, type: string): Response {
  return c.json({ error: { message, type } }, status);
}

function safeJsonParse(text: string | undefined): unknown {
  if (!text) return undefined;
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}
