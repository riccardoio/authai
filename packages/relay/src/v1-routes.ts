import { Hono, type Context } from "hono";
import { stream } from "hono/streaming";
import { verifySessionJwt } from "./jwt.js";
import { getProvider } from "./providers/registry.js";
import type { ProviderId } from "./providers/types.js";
import { loadAndMaybeRefresh } from "./refresh.js";
import type { AuthRecordStore } from "./store.js";

type V1Variables = {
  Variables: {
    recordId: string;
    recordKey: Buffer;
    provider: ProviderId;
  };
};

type V1Context = Context<V1Variables>;

export function createV1Routes(deps: {
  store: AuthRecordStore;
  jwtSecret: Uint8Array;
}): Hono<V1Variables> {
  const app = new Hono<V1Variables>();

  // Uniform 401 for every authentication failure mode (missing header,
  // malformed JWT, bad signature, expired, wrong version, wrong key length).
  // Detail is kept in server-side logs only — we never let callers
  // distinguish failure modes against /v1/* either, matching the
  // /auth/whoami contract.
  app.use("*", async (c, next) => {
    if (c.req.method === "OPTIONS") return next();
    const auth = c.req.header("Authorization") || "";
    const match = auth.match(/^Bearer\s+(.+)$/i);
    if (!match) return unauthorized(c);
    try {
      const verified = await verifySessionJwt(match[1]!, deps.jwtSecret);
      c.set("recordId", verified.recordId);
      c.set("recordKey", verified.recordKey);
      c.set("provider", verified.provider);
    } catch (err) {
      console.warn(
        "[v1] jwt verification failed:",
        err instanceof Error ? err.message : String(err),
      );
      return unauthorized(c);
    }
    return next();
  });

  app.get("/models", async (c) => {
    const resolved = await resolveCredentials(c, deps.store);
    if ("error" in resolved) return resolved.error;
    const adapter = getProvider(resolved.provider);
    try {
      const models = await adapter.listModels({
        access: resolved.access,
        refresh: "",
        expires: 0,
        accountId: resolved.accountId,
      });
      const created = Math.floor(Date.now() / 1000);
      return c.json({
        object: "list",
        data: models.map((m) => ({
          id: m.id,
          object: "model",
          created,
          owned_by: m.ownedBy ?? adapter.displayName,
        })),
      });
    } catch (err) {
      return openaiError(
        c,
        502,
        `cannot list models: ${(err as Error).message}`,
        "provider_error",
      );
    }
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

    const resolved = await resolveCredentials(c, deps.store);
    if ("error" in resolved) return resolved.error;

    const adapter = getProvider(resolved.provider);
    const result = await adapter.proxyChatCompletions({
      tokens: { access: resolved.access, refresh: "", expires: 0, accountId: resolved.accountId },
      body,
      wantsStream: body.stream === true,
    });
    if (!result.ok || !result.body) {
      return providerError(c, result.status, result.text, adapter.displayName);
    }
    c.header("Content-Type", result.contentType ?? "text/event-stream");
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

  app.post("/responses", async (c) => {
    let body: any;
    try {
      body = await c.req.json();
    } catch {
      return openaiError(c, 400, "invalid json body", "invalid_request_error");
    }
    const resolved = await resolveCredentials(c, deps.store);
    if ("error" in resolved) return resolved.error;

    const adapter = getProvider(resolved.provider);
    if (!adapter.proxyResponses) {
      return openaiError(
        c,
        400,
        `${adapter.displayName} does not support the /v1/responses endpoint`,
        "unsupported_endpoint",
      );
    }
    const result = await adapter.proxyResponses({
      tokens: { access: resolved.access, refresh: "", expires: 0, accountId: resolved.accountId },
      body,
      wantsStream: true,
    });
    if (!result.ok || !result.body) {
      return providerError(c, result.status, result.text, adapter.displayName);
    }
    c.header("Content-Type", result.contentType ?? "text/event-stream");
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

  app.all("*", (c) =>
    openaiError(
      c,
      400,
      `Endpoint ${c.req.path} not supported by AuthAI`,
      "unsupported_endpoint",
    ),
  );

  return app;
}

async function resolveCredentials(
  c: V1Context,
  store: AuthRecordStore,
): Promise<
  { provider: ProviderId; access: string; accountId: string } | { error: Response }
> {
  const recordId = c.get("recordId");
  const recordKey = c.get("recordKey");
  const provider = c.get("provider");
  const record = await store.get(recordId);
  if (!record) {
    // Revoked or never existed — surface as the same generic 401.
    console.warn("[v1] record missing for verified jwt:", recordId);
    return { error: unauthorized(c) };
  }
  try {
    const decrypted = await loadAndMaybeRefresh({
      store,
      record,
      recordKey,
      expectedProvider: provider,
    });
    return { provider: decrypted.provider, access: decrypted.access, accountId: decrypted.accountId };
  } catch (err) {
    console.warn(
      "[v1] cannot resolve session:",
      err instanceof Error ? err.message : String(err),
    );
    return { error: unauthorized(c) };
  }
}

function unauthorized(c: V1Context): Response {
  return openaiError(c, 401, "unauthorized", "invalid_request_error");
}

function openaiError(c: V1Context, status: number, message: string, type: string): Response {
  return c.json({ error: { message, type } }, status as 401);
}

/**
 * Wrap an upstream provider failure in the OpenAI error envelope so SDK
 * consumers see a consistent shape regardless of which provider failed.
 *
 * We try to extract a sensible message from the provider body (chatgpt,
 * x.ai, copilot all use slightly different shapes) but never surface their
 * raw envelope to the caller — the openai SDK expects { error: { message,
 * type } } and will throw on anything else.
 */
function providerError(
  c: V1Context,
  status: number,
  text: string | undefined,
  providerDisplayName: string,
): Response {
  const message = extractProviderMessage(text) ?? `${providerDisplayName} returned ${status}`;
  return c.json({ error: { message, type: "provider_error" } }, status as 502);
}

function extractProviderMessage(text: string | undefined): string | null {
  if (!text) return null;
  try {
    const json: any = JSON.parse(text);
    // OpenAI / Codex shape
    if (json?.error?.message) return String(json.error.message);
    // x.ai / generic
    if (json?.message) return String(json.message);
    // GitHub Copilot
    if (json?.error_details?.message) return String(json.error_details.message);
    if (json?.detail) return String(json.detail);
  } catch {
    // Not JSON — fall through and return the raw text if it's plausibly
    // a short status line. Don't echo back giant HTML pages.
    if (text.length <= 200) return text.trim();
  }
  return null;
}
