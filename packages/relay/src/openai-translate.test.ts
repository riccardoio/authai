import { describe, it, expect } from "vitest";
import {
  chatRequestToCodexResponses,
  codexStreamToChatChunks,
  codexStreamToCompletion,
} from "./openai-translate.js";

function asBody(req: Parameters<typeof chatRequestToCodexResponses>[0]) {
  return chatRequestToCodexResponses(req) as Record<string, unknown> & {
    input: Array<{ role: string; content: Array<{ type: string; text: string }> }>;
  };
}

function makeStream(events: object[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      for (const e of events) {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(e)}\n\n`));
      }
      controller.close();
    },
  });
}

async function collect<T>(iter: AsyncIterable<T>): Promise<T[]> {
  const out: T[] = [];
  for await (const item of iter) out.push(item);
  return out;
}

describe("chatRequestToCodexResponses", () => {
  it("collapses multiple system messages into instructions joined by blank line", () => {
    const body = asBody({
      model: "gpt-5.4",
      messages: [
        { role: "system", content: "You are helpful." },
        { role: "system", content: "Be concise." },
        { role: "user", content: "hi" },
      ],
    });
    expect(body.instructions).toBe("You are helpful.\n\nBe concise.");
    expect(body.input).toHaveLength(1);
    expect(body.input[0]).toEqual({
      role: "user",
      content: [{ type: "input_text", text: "hi" }],
    });
  });

  it("treats developer messages the same as system messages", () => {
    const body = asBody({
      model: "gpt-5.4",
      messages: [
        { role: "developer", content: "Internal hint." },
        { role: "user", content: "hi" },
      ],
    });
    expect(body.instructions).toBe("Internal hint.");
  });

  it("falls back to a default system prompt when none is provided", () => {
    const body = asBody({
      model: "gpt-5.4",
      messages: [{ role: "user", content: "hi" }],
    });
    expect(body.instructions).toBe("You are a helpful assistant.");
  });

  it("maps user → input_text and assistant → output_text", () => {
    const body = asBody({
      model: "gpt-5.4",
      messages: [
        { role: "user", content: "first" },
        { role: "assistant", content: "reply" },
        { role: "user", content: "second" },
      ],
    });
    expect(body.input).toEqual([
      { role: "user", content: [{ type: "input_text", text: "first" }] },
      { role: "assistant", content: [{ type: "output_text", text: "reply" }] },
      { role: "user", content: [{ type: "input_text", text: "second" }] },
    ]);
  });

  it("flattens array content into a single concatenated text", () => {
    const body = asBody({
      model: "gpt-5.4",
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: "hello " },
            { type: "text", text: "world" },
          ],
        },
      ],
    });
    expect(body.input[0]!.content[0]!.text).toBe("hello world");
  });

  it("skips messages with empty content", () => {
    const body = asBody({
      model: "gpt-5.4",
      messages: [
        { role: "user", content: "" },
        { role: "user", content: "real" },
      ],
    });
    expect(body.input).toHaveLength(1);
    expect(body.input[0]!.content[0]!.text).toBe("real");
  });

  it("includes temperature only when provided", () => {
    const withTemp = asBody({
      model: "gpt-5.4",
      messages: [{ role: "user", content: "hi" }],
      temperature: 0.7,
    });
    const withoutTemp = asBody({
      model: "gpt-5.4",
      messages: [{ role: "user", content: "hi" }],
    });
    expect(withTemp.temperature).toBe(0.7);
    expect(withoutTemp.temperature).toBeUndefined();
  });

  it("hardcodes stream:true and store:false", () => {
    const body = asBody({
      model: "gpt-5.4",
      messages: [{ role: "user", content: "hi" }],
    });
    expect(body.stream).toBe(true);
    expect(body.store).toBe(false);
  });
});

describe("codexStreamToChatChunks", () => {
  it("translates output_text deltas into Chat-Completions chunks", async () => {
    const stream = makeStream([
      { type: "response.created" },
      { type: "response.output_text.delta", delta: "Hello" },
      { type: "response.output_text.delta", delta: " world" },
      { type: "response.completed" },
    ]);
    const chunks = await collect(codexStreamToChatChunks(stream, "gpt-5.4"));

    const contentChunks = chunks.filter(
      (c) => "choices" in c && c.choices[0]!.delta.content !== undefined,
    ) as Array<{ choices: Array<{ delta: { role?: string; content?: string }; finish_reason: string | null }> }>;
    expect(contentChunks).toHaveLength(2);
    expect(contentChunks[0]!.choices[0]!.delta).toEqual({ role: "assistant", content: "Hello" });
    expect(contentChunks[1]!.choices[0]!.delta).toEqual({ content: " world" });

    const finish = chunks.find(
      (c) => "choices" in c && c.choices[0]!.finish_reason === "stop",
    );
    expect(finish).toBeTruthy();

    const done = chunks.find((c) => "type" in c && c.type === "done");
    expect(done).toBeTruthy();
  });

  it("emits a single stable id across all chunks", async () => {
    const stream = makeStream([
      { type: "response.output_text.delta", delta: "a" },
      { type: "response.output_text.delta", delta: "b" },
      { type: "response.completed" },
    ]);
    const ids = new Set<string>();
    for await (const c of codexStreamToChatChunks(stream, "gpt-5.4")) {
      if ("id" in c) ids.add(c.id);
    }
    expect(ids.size).toBe(1);
  });

  it("emits a finish_reason on response.failed", async () => {
    const stream = makeStream([
      { type: "response.output_text.delta", delta: "partial" },
      { type: "response.failed", error: { message: "model error" } },
    ]);
    const chunks = await collect(codexStreamToChatChunks(stream, "gpt-5.4"));
    const finish = chunks.find(
      (c) => "choices" in c && c.choices[0]!.finish_reason === "stop",
    );
    expect(finish).toBeTruthy();
    const done = chunks.find((c) => "type" in c && c.type === "done");
    expect(done).toBeTruthy();
  });

  it("ignores unknown SSE event types", async () => {
    const stream = makeStream([
      { type: "response.unknown_event", whatever: 1 },
      { type: "response.output_text.delta", delta: "hi" },
      { type: "response.completed" },
    ]);
    const chunks = await collect(codexStreamToChatChunks(stream, "gpt-5.4"));
    const contentChunks = chunks.filter(
      (c) => "choices" in c && c.choices[0]!.delta.content !== undefined,
    );
    expect(contentChunks).toHaveLength(1);
  });
});

describe("codexStreamToCompletion", () => {
  it("accumulates deltas into a single message content", async () => {
    const stream = makeStream([
      { type: "response.output_text.delta", delta: "Hello " },
      { type: "response.output_text.delta", delta: "there." },
      { type: "response.completed" },
    ]);
    const completion = await codexStreamToCompletion(stream, "gpt-5.4");
    expect(completion.choices[0]!.message.content).toBe("Hello there.");
    expect(completion.choices[0]!.finish_reason).toBe("stop");
    expect(completion.object).toBe("chat.completion");
    expect(completion.model).toBe("gpt-5.4");
  });
});
