import { ulid } from "ulid";
import type {
  DeviceCodeStart,
  PendingState,
  PollResult,
  ProviderAdapter,
  ProviderTokens,
  ProxyParams,
  ProxyResult,
} from "../types.js";

const AUTH_BASE = "https://auth.openai.com";
const CODEX_RESPONSES_URL = "https://chatgpt.com/backend-api/codex/responses";
const CLIENT_ID = process.env.AUTH_AI_OPENAI_CODEX_CLIENT_ID || "app_EMoamEEZ73f0CkXaXp7hrann";

// Codex's ChatGPT backend does not expose /v1/models; this is the documented
// catalog accepted by chatgpt.com/backend-api/codex/responses.
const STATIC_MODELS = [
  "gpt-5.4",
  "gpt-5.4-mini",
  "gpt-5.4-pro",
  "gpt-5.4-codex",
  "gpt-5.5",
  "gpt-5.5-pro",
] as const;

const AUTH_CLAIM = "https://api.openai.com/auth";

function authHeaders(originator: string, contentType: string): Record<string, string> {
  return {
    "Content-Type": contentType,
    originator,
    "User-Agent": "authai-relay",
  };
}

function extractAccountId(jwt: string): string {
  const payload = jwt.split(".")[1];
  if (!payload) return "";
  try {
    const json = JSON.parse(Buffer.from(payload, "base64url").toString("utf-8"));
    const auth = json?.[AUTH_CLAIM];
    return typeof auth?.chatgpt_account_id === "string" ? auth.chatgpt_account_id : "";
  } catch {
    return "";
  }
}

function tokensFromResponse(data: any, fallbackRefresh: string | undefined): ProviderTokens {
  const access = String(data.access_token ?? "");
  if (!access) throw new Error("oauth response missing access_token");
  const refresh = String(data.refresh_token ?? fallbackRefresh ?? "");
  const expiresInSec = Number(data.expires_in);
  const expires = Number.isFinite(expiresInSec)
    ? Date.now() + expiresInSec * 1000
    : Date.now() + 60 * 60 * 1000;
  return { access, refresh, expires, accountId: extractAccountId(access) };
}

export function createOpenAICodexAdapter(): ProviderAdapter {
  return {
    id: "openai",
    displayName: "ChatGPT",

    async listModels(_tokens) {
      return STATIC_MODELS.map((id) => ({ id, ownedBy: "openai-codex" }));
    },

    async requestDeviceCode(originator) {
      const res = await fetch(`${AUTH_BASE}/api/accounts/deviceauth/usercode`, {
        method: "POST",
        headers: authHeaders(originator, "application/json"),
        body: JSON.stringify({ client_id: CLIENT_ID }),
      });
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new Error(`device code request failed: ${res.status} ${text}`);
      }
      const data: any = await res.json();
      const deviceAuthId = String(data.device_auth_id ?? "");
      const userCode = String(data.user_code ?? data.usercode ?? "");
      if (!deviceAuthId || !userCode) throw new Error("device code response missing fields");
      const intervalMs = Math.max(1000, Number(data.interval ?? 5) * 1000);
      return {
        deviceAuthId,
        userCode,
        verificationUrl: `${AUTH_BASE}/codex/device`,
        intervalMs,
        expiresInMs: 15 * 60 * 1000,
      } satisfies DeviceCodeStart;
    },

    async pollDeviceCode(state, originator) {
      const res = await fetch(`${AUTH_BASE}/api/accounts/deviceauth/token`, {
        method: "POST",
        headers: authHeaders(originator, "application/json"),
        body: JSON.stringify({ device_auth_id: state.deviceAuthId, user_code: state.userCode }),
      });
      if (res.status === 403 || res.status === 404) {
        return { status: "pending" };
      }
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new Error(`device poll failed: ${res.status} ${text}`);
      }
      const data: any = await res.json();
      const authorizationCode = String(data.authorization_code ?? "");
      const codeVerifier = String(data.code_verifier ?? "");
      if (!authorizationCode || !codeVerifier) {
        throw new Error("device poll missing exchange code");
      }
      const exchangeRes = await fetch(`${AUTH_BASE}/oauth/token`, {
        method: "POST",
        headers: authHeaders(originator, "application/x-www-form-urlencoded"),
        body: new URLSearchParams({
          grant_type: "authorization_code",
          code: authorizationCode,
          redirect_uri: `${AUTH_BASE}/deviceauth/callback`,
          client_id: CLIENT_ID,
          code_verifier: codeVerifier,
        }),
      });
      if (!exchangeRes.ok) {
        const text = await exchangeRes.text().catch(() => "");
        throw new Error(`token exchange failed: ${exchangeRes.status} ${text}`);
      }
      const tokens = tokensFromResponse(await exchangeRes.json(), undefined);
      return { status: "ready", tokens };
    },

    async refreshTokens(refresh, originator) {
      const res = await fetch(`${AUTH_BASE}/oauth/token`, {
        method: "POST",
        headers: authHeaders(originator, "application/x-www-form-urlencoded"),
        body: new URLSearchParams({
          grant_type: "refresh_token",
          refresh_token: refresh,
          client_id: CLIENT_ID,
          scope: "openid profile email",
        }),
      });
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new Error(`refresh failed: ${res.status} ${text}`);
      }
      return tokensFromResponse(await res.json(), refresh);
    },

    async proxyChatCompletions({ tokens, body, wantsStream }) {
      const codexBody = chatRequestToCodexResponses(body as any);
      const res = await fetch(CODEX_RESPONSES_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${tokens.access}`,
          "chatgpt-account-id": tokens.accountId,
          "OpenAI-Beta": "responses=experimental",
        },
        body: JSON.stringify(codexBody),
      });
      if (!res.ok || !res.body) {
        return {
          ok: false,
          status: res.status,
          body: null,
          text: await res.text().catch(() => ""),
        };
      }
      const model = (body as any).model ?? "gpt-5.4";
      if (wantsStream) {
        return {
          ok: true,
          status: 200,
          body: codexToChatCompletionsSse(res.body, model),
          contentType: "text/event-stream",
        };
      }
      const completion = await codexStreamToCompletion(res.body, model);
      const json = JSON.stringify(completion);
      return {
        ok: true,
        status: 200,
        body: new ReadableStream<Uint8Array>({
          start(c) {
            c.enqueue(new TextEncoder().encode(json));
            c.close();
          },
        }),
        contentType: "application/json",
      };
    },

    async proxyResponses({ tokens, body }) {
      const res = await fetch(CODEX_RESPONSES_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${tokens.access}`,
          "chatgpt-account-id": tokens.accountId,
          "OpenAI-Beta": "responses=experimental",
        },
        body: JSON.stringify(body),
      });
      if (!res.ok || !res.body) {
        return {
          ok: false,
          status: res.status,
          body: null,
          text: await res.text().catch(() => ""),
        };
      }
      return {
        ok: true,
        status: 200,
        body: res.body,
        contentType: res.headers.get("Content-Type") ?? "text/event-stream",
      };
    },
  };
}

// ---- Chat Completions <-> Codex Responses translation ----

import {
  chatRequestToCodexResponses,
  codexStreamToChatChunks,
  codexStreamToCompletion,
  encodeSseChunk,
  encodeSseDone,
} from "../../openai-translate.js";

function codexToChatCompletionsSse(
  body: ReadableStream<Uint8Array>,
  model: string,
): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        for await (const ev of codexStreamToChatChunks(body, model)) {
          if ("type" in ev && ev.type === "done") {
            controller.enqueue(encodeSseDone());
            controller.close();
            return;
          }
          controller.enqueue(encodeSseChunk(ev as any));
        }
        controller.enqueue(encodeSseDone());
        controller.close();
      } catch (err) {
        controller.error(err);
      }
    },
  });
}

// Silence unused warning for ulid import used in tests during refactor
void ulid;
