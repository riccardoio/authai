import { authai, AuthAIUnauthorized } from "@authai-io/server";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const jwt = req.headers.get("authorization")?.slice("Bearer ".length);
  const { messages } = await req.json();

  try {
    const { openai } = await authai.session({
      jwt,
      relayUrl: process.env.AUTHAI_RELAY_URL ?? "https://relay.authai.io",
    });
    if (!openai) return new Response("Install `openai` peer", { status: 500 });

    const stream = await openai.chat.completions.create({
      model: "gpt-5.4",
      messages,
      stream: true,
    });

    const encoder = new TextEncoder();
    const body = new ReadableStream({
      async start(controller) {
        for await (const chunk of stream) {
          const delta = chunk.choices[0]?.delta?.content;
          if (delta) controller.enqueue(encoder.encode(delta));
        }
        controller.close();
      },
    });
    return new Response(body, { headers: { "Content-Type": "text/plain" } });
  } catch (err) {
    if (err instanceof AuthAIUnauthorized) return new Response("Unauthorized", { status: 401 });
    throw err;
  }
}
