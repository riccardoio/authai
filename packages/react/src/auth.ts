export type ProviderId = "openai" | "xai" | "github";

// Mirror of the /auth/providers response shape. The relay only returns
// id + displayName today; model lists are scoped per-session and live
// behind /v1/models. Do not add fields here without a matching server
// change — consumers will silently see `undefined`.
export type ProviderInfo = {
  id: ProviderId;
  displayName: string;
};

export type StartResponse = {
  sessionId: string;
  provider: ProviderId;
  userCode: string;
  verificationUrl: string;
  expiresInMs: number;
  pollIntervalMs: number;
};

export type PollResponse =
  | { status: "pending" }
  | { status: "complete"; jwt: string }
  | { status: "expired"; error?: string }
  | { status: "error"; error: string };

export type SignInOptions = {
  relayUrl: string;
  provider: ProviderId;
  onVerification: (info: {
    verificationUrl: string;
    userCode: string;
    expiresInMs: number;
  }) => void | Promise<void>;
  signal?: AbortSignal;
};

export async function signInWithProvider(options: SignInOptions): Promise<string> {
  const start = await postJson<StartResponse>(
    joinUrl(options.relayUrl, "/auth/start"),
    { provider: options.provider },
    options.signal,
  );

  await options.onVerification({
    verificationUrl: start.verificationUrl,
    userCode: start.userCode,
    expiresInMs: start.expiresInMs,
  });

  const deadline = Date.now() + start.expiresInMs;
  const interval = Math.max(1000, start.pollIntervalMs);

  while (Date.now() < deadline) {
    if (options.signal?.aborted) throw new DOMException("aborted", "AbortError");
    await sleep(interval, options.signal);

    const poll = await getJson<PollResponse>(
      joinUrl(options.relayUrl, `/auth/poll/${start.sessionId}`),
      options.signal,
    );
    if (poll.status === "complete") return poll.jwt;
    if (poll.status === "error") throw new Error(poll.error || "auth error");
    if (poll.status === "expired") throw new Error("authorization expired");
  }
  throw new Error("authorization timed out");
}

export async function listProviders(relayUrl: string, signal?: AbortSignal): Promise<ProviderInfo[]> {
  const res = await getJson<{ providers: ProviderInfo[] }>(
    joinUrl(relayUrl, "/auth/providers"),
    signal,
  );
  return res.providers;
}

export function decodeJwtProvider(jwt: string): ProviderId | null {
  try {
    const payloadPart = jwt.split(".")[1];
    if (!payloadPart) return null;
    // Browser-only base64url decode. We rely on `atob`, which is in every
    // modern browser. Server-side consumers shouldn't be decoding the JWT
    // unverified — they should call /auth/whoami via @authai/server.
    if (typeof atob !== "function") return null;
    const decoded = atob(
      payloadPart.replace(/-/g, "+").replace(/_/g, "/") +
        "=".repeat((4 - (payloadPart.length % 4)) % 4),
    );
    const json = JSON.parse(decoded);
    const prov = json?.prov;
    if (prov === "openai" || prov === "xai" || prov === "github") return prov;
    return null;
  } catch {
    return null;
  }
}

/**
 * Lightweight client-side check: does this JWT parse AND have an unexpired
 * `exp` claim? Does NOT verify the signature — that's the relay's job. Use
 * to validate `initialJwt` SSR hand-offs before trusting them.
 *
 * SSR note: when `atob` is unavailable (Node without polyfill), returns true
 * to defer judgment to the client hydration pass. This is the right default
 * for SSR initialJwt — the server has already decoded the cookie moments ago
 * and any expired-token rejection should happen authoritatively at hydration.
 * It is unreachable from singleton storage hydration because that path is
 * gated behind isBrowser() before this function is called.
 */
export function isJwtCurrentlyValid(jwt: string): boolean {
  try {
    const payloadPart = jwt.split(".")[1];
    if (!payloadPart) return false;
    if (typeof atob !== "function") return true; // SSR — defer judgment to client hydration
    const decoded = atob(
      payloadPart.replace(/-/g, "+").replace(/_/g, "/") +
        "=".repeat((4 - (payloadPart.length % 4)) % 4),
    );
    const json = JSON.parse(decoded);
    const exp = json?.exp;
    if (typeof exp !== "number") return false;
    return exp > Math.floor(Date.now() / 1000);
  } catch {
    return false;
  }
}

export async function revokeSession(relayUrl: string, jwt: string): Promise<void> {
  await fetch(joinUrl(relayUrl, "/auth/revoke"), {
    method: "POST",
    headers: { Authorization: `Bearer ${jwt}` },
  });
}

async function postJson<T>(url: string, body?: unknown, signal?: AbortSignal): Promise<T> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: body !== undefined ? JSON.stringify(body) : undefined,
    signal,
  });
  return readJsonBody<T>(res, url);
}

async function getJson<T>(url: string, signal?: AbortSignal): Promise<T> {
  const res = await fetch(url, { signal });
  return readJsonBody<T>(res, url);
}

async function readJsonBody<T>(res: Response, url: string): Promise<T> {
  const text = await res.text().catch(() => "");
  let body: any = null;
  if (text.length > 0) {
    try { body = JSON.parse(text); } catch { /* not json */ }
  }
  if (!res.ok) {
    if (body && typeof body.error === "string") throw new Error(body.error);
    if (typeof body?.error?.message === "string") throw new Error(body.error.message);
    throw new Error(`relay ${url}: ${res.status}`);
  }
  return body as T;
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(resolve, ms);
    if (signal) {
      const onAbort = () => {
        clearTimeout(t);
        reject(new DOMException("aborted", "AbortError"));
      };
      if (signal.aborted) onAbort();
      else signal.addEventListener("abort", onAbort, { once: true });
    }
  });
}

function joinUrl(base: string, path: string): string {
  return base.replace(/\/+$/, "") + path;
}
