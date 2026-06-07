import type {
  DeviceCodeStart,
  PendingState,
  PollResult,
  ProviderAdapter,
  ProviderTokens,
  ProxyParams,
  ProxyResult,
} from "../types.js";

const CLIENT_ID = process.env.AUTH_AI_XAI_CLIENT_ID || "b1a00492-073a-47ea-816f-4c329264a828";
const SCOPE = "openid profile email offline_access grok-cli:access api:access";
const DISCOVERY_URL = "https://auth.x.ai/.well-known/openid-configuration";
const API_BASE = "https://api.x.ai/v1";
const DEVICE_CODE_GRANT = "urn:ietf:params:oauth:grant-type:device_code";


type Discovery = { deviceAuthorizationEndpoint: string; tokenEndpoint: string };
let discoveryCache: Promise<Discovery> | null = null;

async function getDiscovery(): Promise<Discovery> {
  if (!discoveryCache) {
    discoveryCache = (async () => {
      const res = await fetch(DISCOVERY_URL, { headers: { Accept: "application/json" } });
      if (!res.ok) throw new Error(`xAI discovery failed: ${res.status}`);
      const json: any = await res.json();
      const dev = String(json.device_authorization_endpoint ?? "");
      const tok = String(json.token_endpoint ?? "");
      if (!dev || !tok) throw new Error("xAI discovery missing endpoints");
      return { deviceAuthorizationEndpoint: dev, tokenEndpoint: tok };
    })();
    discoveryCache.catch(() => {
      discoveryCache = null;
    });
  }
  return discoveryCache;
}

function tokensFromResponse(data: any, fallbackRefresh: string | undefined): ProviderTokens {
  const access = String(data.access_token ?? "");
  if (!access) throw new Error("oauth response missing access_token");
  const refresh = String(data.refresh_token ?? fallbackRefresh ?? "");
  const expiresInSec = Number(data.expires_in);
  const expires = Number.isFinite(expiresInSec)
    ? Date.now() + expiresInSec * 1000
    : Date.now() + 60 * 60 * 1000;
  return { access, refresh, expires, accountId: extractSubject(access) };
}

function extractSubject(jwt: string): string {
  const payload = jwt.split(".")[1];
  if (!payload) return "";
  try {
    const json = JSON.parse(Buffer.from(payload, "base64url").toString("utf-8"));
    return typeof json?.sub === "string" ? json.sub : "";
  } catch {
    return "";
  }
}

export function createXaiAdapter(): ProviderAdapter {
  return {
    id: "xai",
    displayName: "Grok",

    async listModels(tokens) {
      const res = await fetch(`${API_BASE}/models`, {
        headers: { Authorization: `Bearer ${tokens.access}`, Accept: "application/json" },
      });
      if (!res.ok) throw new Error(`xAI /models failed: ${res.status}`);
      const json: any = await res.json();
      const data: any[] = Array.isArray(json?.data) ? json.data : [];
      return data
        .map((m) => ({ id: String(m?.id ?? ""), ownedBy: String(m?.owned_by ?? "xai") }))
        .filter((m) => m.id.length > 0);
    },

    async requestDeviceCode(_originator) {
      const { deviceAuthorizationEndpoint } = await getDiscovery();
      const res = await fetch(deviceAuthorizationEndpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          Accept: "application/json",
          "User-Agent": "authai-relay",
        },
        body: new URLSearchParams({ client_id: CLIENT_ID, scope: SCOPE }),
      });
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new Error(`xAI device code request failed: ${res.status} ${text}`);
      }
      const data: any = await res.json();
      const deviceCode = String(data.device_code ?? "");
      const userCode = String(data.user_code ?? "");
      const verificationUrl = String(data.verification_uri_complete ?? data.verification_uri ?? "");
      if (!deviceCode || !userCode || !verificationUrl) {
        throw new Error("xAI device code response missing fields");
      }
      const intervalMs = Math.max(1000, Number(data.interval ?? 5) * 1000);
      const expiresInMs = Math.max(60_000, Number(data.expires_in ?? 600) * 1000);
      return {
        deviceAuthId: deviceCode,
        userCode,
        verificationUrl,
        intervalMs,
        expiresInMs,
      } satisfies DeviceCodeStart;
    },

    async pollDeviceCode(state, _originator) {
      const { tokenEndpoint } = await getDiscovery();
      const res = await fetch(tokenEndpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          Accept: "application/json",
          "User-Agent": "authai-relay",
        },
        body: new URLSearchParams({
          grant_type: DEVICE_CODE_GRANT,
          client_id: CLIENT_ID,
          device_code: state.deviceAuthId,
        }),
      });
      const data: any = await res.json().catch(() => ({}));
      if (res.ok && data?.access_token) {
        return { status: "ready", tokens: tokensFromResponse(data, undefined) };
      }
      const err = String(data?.error ?? "");
      if (
        err === "authorization_pending" ||
        err === "slow_down" ||
        res.status === 400 && (err === "" || err === "authorization_pending")
      ) {
        return { status: "pending" };
      }
      throw new Error(`xAI device poll failed: ${res.status} ${err || JSON.stringify(data)}`);
    },

    async refreshTokens(refresh, _originator) {
      const { tokenEndpoint } = await getDiscovery();
      const res = await fetch(tokenEndpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          Accept: "application/json",
          "User-Agent": "authai-relay",
        },
        body: new URLSearchParams({
          grant_type: "refresh_token",
          refresh_token: refresh,
          client_id: CLIENT_ID,
        }),
      });
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new Error(`xAI refresh failed: ${res.status} ${text}`);
      }
      return tokensFromResponse(await res.json(), refresh);
    },

    async proxyChatCompletions({ tokens, body, wantsStream }) {
      const res = await fetch(`${API_BASE}/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${tokens.access}`,
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
          res.headers.get("Content-Type") ?? (wantsStream ? "text/event-stream" : "application/json"),
      };
    },
  };
}
