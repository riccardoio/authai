const CODEX_RESPONSES_URL = "https://chatgpt.com/backend-api/codex/responses";

export type CodexCredentials = {
  access: string;
  accountId: string;
};

export type CodexResponseResult = {
  ok: boolean;
  status: number;
  headers: Headers;
  body: ReadableStream<Uint8Array> | null;
  text?: string;
};

export async function callCodexResponses(params: {
  credentials: CodexCredentials;
  body: unknown;
}): Promise<CodexResponseResult> {
  const res = await fetch(CODEX_RESPONSES_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${params.credentials.access}`,
      "chatgpt-account-id": params.credentials.accountId,
      "OpenAI-Beta": "responses=experimental",
    },
    body: JSON.stringify(params.body),
  });
  if (!res.ok) {
    return { ok: false, status: res.status, headers: res.headers, body: null, text: await res.text() };
  }
  return { ok: true, status: res.status, headers: res.headers, body: res.body };
}

export const SUPPORTED_CODEX_MODELS = [
  "gpt-5.4",
  "gpt-5.4-mini",
  "gpt-5.4-pro",
  "gpt-5.4-codex",
  "gpt-5.5",
  "gpt-5.5-pro",
] as const;
