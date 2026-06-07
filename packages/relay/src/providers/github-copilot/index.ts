import { createHash } from "node:crypto";
import type {
  DeviceCodeStart,
  PollResult,
  ProviderAdapter,
  ProviderTokens,
  ProxyParams,
  ProxyResult,
} from "../types.js";

const CLIENT_ID = process.env.AUTH_AI_GITHUB_CLIENT_ID || "Iv1.b507a08c87ecfe98";
const DEVICE_CODE_URL = "https://github.com/login/device/code";
const ACCESS_TOKEN_URL = "https://github.com/login/oauth/access_token";
const VERIFICATION_URL = "https://github.com/login/device";
const COPILOT_TOKEN_URL = "https://api.github.com/copilot_internal/v2/token";
const DEFAULT_COPILOT_API_BASE = "https://api.individual.githubcopilot.com";
const SCOPE = "read:user";

const COPILOT_INTEGRATION_ID = "vscode-chat";
const COPILOT_EDITOR_VERSION = "vscode/1.107.0";
const COPILOT_EDITOR_PLUGIN_VERSION = "copilot-chat/0.35.0";
const COPILOT_USER_AGENT = "GitHubCopilotChat/0.35.0";
const COPILOT_GITHUB_API_VERSION = "2025-04-01";


function ideHeaders(includeApiVersion = false): Record<string, string> {
  return {
    "Accept-Encoding": "identity",
    "Editor-Version": COPILOT_EDITOR_VERSION,
    "Editor-Plugin-Version": COPILOT_EDITOR_PLUGIN_VERSION,
    "User-Agent": COPILOT_USER_AGENT,
    ...(includeApiVersion ? { "X-Github-Api-Version": COPILOT_GITHUB_API_VERSION } : {}),
  };
}

type CachedCopilotToken = { token: string; expiresAt: number; baseUrl: string };
const copilotTokenCache = new Map<string, CachedCopilotToken>();

function cacheKey(githubToken: string): string {
  return createHash("sha256").update(githubToken).digest("hex");
}

function deriveBaseUrlFromCopilotToken(token: string): string | null {
  const parts = token.split(";");
  for (const part of parts) {
    const [k, v] = part.split("=");
    if (k === "endpoints" && v) {
      try {
        const decoded = JSON.parse(decodeURIComponent(v));
        if (typeof decoded?.api === "string" && decoded.api.length > 0) return decoded.api;
      } catch { /* ignore */ }
    }
  }
  return null;
}

// Promise-coalescing for in-flight Copilot token exchanges. Without this,
// N concurrent first requests for the same GitHub token each fire their own
// /copilot_internal/v2/token call — a stampede that GitHub will eventually
// rate-limit. Storing a `Promise<entry>` in `inFlight` means later callers
// await the same fetch, and the entry is settled into `copilotTokenCache`
// once for everyone. The in-flight map is cleared in `finally` so failed
// exchanges don't poison subsequent retries.
const inFlight = new Map<string, Promise<CachedCopilotToken>>();

async function resolveCopilotToken(githubToken: string): Promise<CachedCopilotToken> {
  const key = cacheKey(githubToken);
  const cached = copilotTokenCache.get(key);
  if (cached && cached.expiresAt - Date.now() > 5 * 60 * 1000) return cached;

  const existing = inFlight.get(key);
  if (existing) return existing;

  const promise = exchangeCopilotToken(githubToken, key).finally(() => {
    inFlight.delete(key);
  });
  inFlight.set(key, promise);
  return promise;
}

async function exchangeCopilotToken(
  githubToken: string,
  key: string,
): Promise<CachedCopilotToken> {
  const res = await fetch(COPILOT_TOKEN_URL, {
    method: "GET",
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${githubToken}`,
      "Copilot-Integration-Id": COPILOT_INTEGRATION_ID,
      ...ideHeaders(true),
    },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    let friendly: string | null = null;
    try {
      const json: any = JSON.parse(text);
      if (json?.error_details?.message) friendly = String(json.error_details.message);
      else if (json?.message) friendly = String(json.message);
    } catch { /* ignore */ }
    throw new Error(friendly ?? `Copilot token exchange failed (HTTP ${res.status})`);
  }
  const json: any = await res.json();
  const token = String(json.token ?? "");
  if (!token) throw new Error("Copilot token response missing token");
  const expiresAtSec = Number(json.expires_at);
  const expiresAt = Number.isFinite(expiresAtSec)
    ? expiresAtSec * 1000
    : Date.now() + 30 * 60 * 1000;
  const baseUrl = deriveBaseUrlFromCopilotToken(token) ?? DEFAULT_COPILOT_API_BASE;
  const entry: CachedCopilotToken = { token, expiresAt, baseUrl };
  copilotTokenCache.set(key, entry);
  return entry;
}

async function fetchGithubUserId(token: string): Promise<string> {
  // We require a real, non-empty user id so two anonymous sign-ins cannot
  // share an identityId. Returning "" here would let `auth-routes.ts` /poll
  // collapse multiple users into a single record. Treat any failure as fatal.
  const res = await fetch("https://api.github.com/user", {
    headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`GitHub /user lookup failed: ${res.status} ${text}`);
  }
  const json: any = await res.json();
  const id = json?.id ?? json?.login;
  if (id === undefined || id === null || String(id).length === 0) {
    throw new Error("GitHub /user lookup returned no usable id");
  }
  return String(id);
}

export function createGitHubCopilotAdapter(): ProviderAdapter {
  return {
    id: "github",
    displayName: "GitHub Copilot",

    async listModels(tokens) {
      const copilot = await resolveCopilotToken(tokens.access);
      const url = `${copilot.baseUrl.replace(/\/+$/, "")}/models`;
      const res = await fetch(url, {
        method: "GET",
        headers: {
          Accept: "application/json",
          Authorization: `Bearer ${copilot.token}`,
          "Copilot-Integration-Id": COPILOT_INTEGRATION_ID,
          ...ideHeaders(),
        },
      });
      if (!res.ok) throw new Error(`Copilot /models failed: ${res.status}`);
      const json: any = await res.json();
      const data: any[] = Array.isArray(json?.data) ? json.data : [];
      const seen = new Set<string>();
      const out: { id: string; ownedBy?: string }[] = [];
      for (const m of data) {
        const id = String(m?.id ?? "");
        if (!id || seen.has(id)) continue;
        const endpoints = Array.isArray(m?.supported_endpoints) ? m.supported_endpoints : [];
        if (endpoints.length > 0 && !endpoints.includes("/v1/chat/completions")) continue;
        seen.add(id);
        out.push({ id, ownedBy: String(m?.vendor ?? "github-copilot") });
      }
      return out;
    },

    async requestDeviceCode(_originator) {
      const res = await fetch(DEVICE_CODE_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          Accept: "application/json",
        },
        body: new URLSearchParams({ client_id: CLIENT_ID, scope: SCOPE }),
      });
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new Error(`GitHub device code failed: ${res.status} ${text}`);
      }
      const data: any = await res.json();
      const deviceCode = String(data.device_code ?? "");
      const userCode = String(data.user_code ?? "");
      if (!deviceCode || !userCode) throw new Error("GitHub device code response missing fields");
      const intervalMs = Math.max(1000, Number(data.interval ?? 5) * 1000);
      const expiresInMs = Math.max(60_000, Number(data.expires_in ?? 900) * 1000);
      return {
        deviceAuthId: deviceCode,
        userCode,
        verificationUrl: String(data.verification_uri ?? VERIFICATION_URL),
        intervalMs,
        expiresInMs,
      } satisfies DeviceCodeStart;
    },

    async pollDeviceCode(state, _originator) {
      const res = await fetch(ACCESS_TOKEN_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          Accept: "application/json",
        },
        body: new URLSearchParams({
          client_id: CLIENT_ID,
          device_code: state.deviceAuthId,
          grant_type: "urn:ietf:params:oauth:grant-type:device_code",
        }),
      });
      const data: any = await res.json().catch(() => ({}));

      if (data?.error === "authorization_pending" || data?.error === "slow_down") {
        return { status: "pending" };
      }
      if (data?.error) {
        throw new Error(`GitHub device poll failed: ${data.error} ${data.error_description ?? ""}`);
      }
      const accessToken = String(data?.access_token ?? "");
      if (!accessToken) {
        if (!res.ok) throw new Error(`GitHub device poll failed: ${res.status}`);
        throw new Error("GitHub device poll missing access_token");
      }
      // Verify the user actually has a Copilot subscription before we issue a
      // session JWT. Without this check, sign-in appears to succeed and the
      // failure only surfaces on the first chat call.
      await resolveCopilotToken(accessToken);
      const accountId = await fetchGithubUserId(accessToken);
      return {
        status: "ready",
        tokens: {
          access: accessToken,
          refresh: "",
          expires: Date.now() + 365 * 24 * 60 * 60 * 1000,
          accountId,
        } satisfies ProviderTokens,
      };
    },

    async refreshTokens(_refresh, _originator) {
      throw new Error(
        "GitHub OAuth device tokens do not refresh; sign in again to reissue",
      );
    },

    async proxyChatCompletions({ tokens, body }) {
      const copilot = await resolveCopilotToken(tokens.access);
      const url = `${copilot.baseUrl.replace(/\/+$/, "")}/chat/completions`;
      const res = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${copilot.token}`,
          "Copilot-Integration-Id": COPILOT_INTEGRATION_ID,
          "Openai-Organization": "github-copilot",
          ...ideHeaders(),
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
        contentType:
          res.headers.get("Content-Type") ??
          ((body as any)?.stream ? "text/event-stream" : "application/json"),
      } satisfies ProxyResult;
    },
  };
}
