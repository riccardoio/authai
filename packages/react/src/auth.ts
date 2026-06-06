export type StartResponse = {
  sessionId: string;
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
  onVerification: (info: {
    verificationUrl: string;
    userCode: string;
    expiresInMs: number;
  }) => void | Promise<void>;
  signal?: AbortSignal;
};

export async function signInWithChatGPT(options: SignInOptions): Promise<string> {
  const start = await postJson<StartResponse>(
    joinUrl(options.relayUrl, "/auth/start"),
    undefined,
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
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`relay ${url}: ${res.status} ${text}`);
  }
  return (await res.json()) as T;
}

async function getJson<T>(url: string, signal?: AbortSignal): Promise<T> {
  const res = await fetch(url, { signal });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`relay ${url}: ${res.status} ${text}`);
  }
  return (await res.json()) as T;
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
