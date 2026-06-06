import { ulid } from "ulid";

type ChatRole = "system" | "user" | "assistant" | "tool" | "developer";

type ChatMessage = {
  role: ChatRole;
  content: string | Array<{ type: string; text?: string }> | null;
  name?: string;
};

type ChatCompletionRequest = {
  model: string;
  messages: ChatMessage[];
  stream?: boolean;
  temperature?: number;
};

type ChatCompletionChunk = {
  id: string;
  object: "chat.completion.chunk";
  created: number;
  model: string;
  choices: Array<{
    index: number;
    delta: { role?: "assistant"; content?: string };
    finish_reason: string | null;
  }>;
};

type ChatCompletion = {
  id: string;
  object: "chat.completion";
  created: number;
  model: string;
  choices: Array<{
    index: number;
    message: { role: "assistant"; content: string };
    finish_reason: string;
  }>;
  usage?: { prompt_tokens: number; completion_tokens: number; total_tokens: number };
};

export function chatRequestToCodexResponses(req: ChatCompletionRequest): unknown {
  const systemParts: string[] = [];
  const input: unknown[] = [];

  for (const msg of req.messages) {
    if (msg.role === "system" || msg.role === "developer") {
      systemParts.push(messageContentToText(msg.content));
      continue;
    }
    const text = messageContentToText(msg.content);
    if (text.length === 0) continue;
    input.push({
      role: msg.role,
      content: [
        {
          type: msg.role === "assistant" ? "output_text" : "input_text",
          text,
        },
      ],
    });
  }

  const body: Record<string, unknown> = {
    model: req.model,
    store: false,
    stream: true,
    instructions:
      systemParts.length > 0 ? systemParts.join("\n\n") : "You are a helpful assistant.",
    input,
  };
  if (typeof req.temperature === "number") body.temperature = req.temperature;
  return body;
}

function messageContentToText(
  content: ChatMessage["content"],
): string {
  if (content == null) return "";
  if (typeof content === "string") return content;
  return content
    .map((part) => (typeof part.text === "string" ? part.text : ""))
    .filter((s) => s.length > 0)
    .join("");
}

export async function* codexStreamToChatChunks(
  body: ReadableStream<Uint8Array>,
  model: string,
): AsyncGenerator<ChatCompletionChunk | { type: "done" }> {
  const id = `chatcmpl-${ulid()}`;
  const created = Math.floor(Date.now() / 1000);
  let firstChunk = true;

  for await (const event of parseSse(body)) {
    if (event.type === "response.output_text.delta" && typeof event.delta === "string") {
      const delta: ChatCompletionChunk["choices"][0]["delta"] = { content: event.delta };
      if (firstChunk) {
        delta.role = "assistant";
        firstChunk = false;
      }
      yield {
        id,
        object: "chat.completion.chunk",
        created,
        model,
        choices: [{ index: 0, delta, finish_reason: null }],
      };
    } else if (event.type === "response.completed") {
      yield {
        id,
        object: "chat.completion.chunk",
        created,
        model,
        choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
      };
      yield { type: "done" };
      return;
    } else if (
      event.type === "response.failed" ||
      event.type === "response.incomplete" ||
      event.type === "error"
    ) {
      yield {
        id,
        object: "chat.completion.chunk",
        created,
        model,
        choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
      };
      yield { type: "done" };
      return;
    }
  }
  yield { type: "done" };
}

export async function codexStreamToCompletion(
  body: ReadableStream<Uint8Array>,
  model: string,
): Promise<ChatCompletion> {
  let accumulated = "";
  for await (const event of parseSse(body)) {
    if (event.type === "response.output_text.delta" && typeof event.delta === "string") {
      accumulated += event.delta;
    }
  }
  return {
    id: `chatcmpl-${ulid()}`,
    object: "chat.completion",
    created: Math.floor(Date.now() / 1000),
    model,
    choices: [
      {
        index: 0,
        message: { role: "assistant", content: accumulated },
        finish_reason: "stop",
      },
    ],
  };
}

type SseEvent = { type?: string; delta?: string; [k: string]: unknown };

async function* parseSse(body: ReadableStream<Uint8Array>): AsyncGenerator<SseEvent> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    let idx;
    while ((idx = buffer.indexOf("\n\n")) !== -1) {
      const raw = buffer.slice(0, idx);
      buffer = buffer.slice(idx + 2);
      const dataLine = raw
        .split("\n")
        .find((l) => l.startsWith("data:"))
        ?.slice(5)
        .trim();
      if (!dataLine || dataLine === "[DONE]") continue;
      try {
        yield JSON.parse(dataLine) as SseEvent;
      } catch {
        /* skip malformed */
      }
    }
  }
}

export function encodeSseChunk(chunk: ChatCompletionChunk): Uint8Array {
  return new TextEncoder().encode(`data: ${JSON.stringify(chunk)}\n\n`);
}

export function encodeSseDone(): Uint8Array {
  return new TextEncoder().encode("data: [DONE]\n\n");
}
