const AUTH_BASE = "https://auth.openai.com";
const CODEX_CLIENT_ID = process.env.AUTH_AI_CODEX_CLIENT_ID || "app_EMoamEEZ73f0CkXaXp7hrann";

function originator(): string {
  const value = process.env.AUTH_AI_ORIGINATOR;
  if (!value || value.length === 0) {
    throw new Error("AUTH_AI_ORIGINATOR is required");
  }
  return value;
}

function headers(contentType: string): Record<string, string> {
  return {
    "Content-Type": contentType,
    originator: originator(),
    "User-Agent": "authai-relay",
  };
}

export type DeviceCode = {
  deviceAuthId: string;
  userCode: string;
  intervalMs: number;
  verificationUrl: string;
};

export type Tokens = {
  access: string;
  refresh: string;
  expires: number;
  accountId: string;
};

export async function requestDeviceCode(): Promise<DeviceCode> {
  const res = await fetch(`${AUTH_BASE}/api/accounts/deviceauth/usercode`, {
    method: "POST",
    headers: headers("application/json"),
    body: JSON.stringify({ client_id: CODEX_CLIENT_ID }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`device code request failed: ${res.status} ${text}`);
  }
  const data: any = await res.json();
  const deviceAuthId = String(data.device_auth_id ?? "");
  const userCode = String(data.user_code ?? data.usercode ?? "");
  if (!deviceAuthId || !userCode) {
    throw new Error("device code response missing fields");
  }
  return {
    deviceAuthId,
    userCode,
    intervalMs: Math.max(1000, Number(data.interval ?? 5) * 1000),
    verificationUrl: `${AUTH_BASE}/codex/device`,
  };
}

export type PollResult =
  | { status: "pending" }
  | { status: "ready"; authorizationCode: string; codeVerifier: string };

export async function pollDeviceCode(
  deviceAuthId: string,
  userCode: string,
): Promise<PollResult> {
  const res = await fetch(`${AUTH_BASE}/api/accounts/deviceauth/token`, {
    method: "POST",
    headers: headers("application/json"),
    body: JSON.stringify({ device_auth_id: deviceAuthId, user_code: userCode }),
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
  return { status: "ready", authorizationCode, codeVerifier };
}

export async function exchangeCode(params: {
  authorizationCode: string;
  codeVerifier: string;
}): Promise<Tokens> {
  const res = await fetch(`${AUTH_BASE}/oauth/token`, {
    method: "POST",
    headers: headers("application/x-www-form-urlencoded"),
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code: params.authorizationCode,
      redirect_uri: `${AUTH_BASE}/deviceauth/callback`,
      client_id: CODEX_CLIENT_ID,
      code_verifier: params.codeVerifier,
    }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`token exchange failed: ${res.status} ${text}`);
  }
  const data: any = await res.json();
  return tokensFromResponse(data, undefined);
}

export async function refreshTokens(refreshToken: string): Promise<Tokens> {
  const res = await fetch(`${AUTH_BASE}/oauth/token`, {
    method: "POST",
    headers: headers("application/x-www-form-urlencoded"),
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
      client_id: CODEX_CLIENT_ID,
      scope: "openid profile email",
    }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`refresh failed: ${res.status} ${text}`);
  }
  const data: any = await res.json();
  return tokensFromResponse(data, refreshToken);
}

function tokensFromResponse(data: any, fallbackRefresh: string | undefined): Tokens {
  const access = String(data.access_token ?? "");
  if (!access) throw new Error("oauth response missing access_token");
  const refresh = String(data.refresh_token ?? fallbackRefresh ?? "");
  const expiresInSec = Number(data.expires_in);
  const expires = Number.isFinite(expiresInSec)
    ? Date.now() + expiresInSec * 1000
    : Date.now() + 60 * 60 * 1000;
  return { access, refresh, expires, accountId: extractAccountId(access) };
}

const AUTH_CLAIM = "https://api.openai.com/auth";

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
