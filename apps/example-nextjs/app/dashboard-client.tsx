"use client";

import { SignIn, useAuthAI } from "@authai/react";
import { useState } from "react";

export function DashboardClient() {
  const { isSignedIn, signOut, jwt } = useAuthAI();
  const [reply, setReply] = useState("");
  const [pending, setPending] = useState(false);

  if (!isSignedIn || !jwt) {
    return <SignIn>Sign in</SignIn>;
  }

  async function ask(prompt: string) {
    setReply(""); setPending(true);
    const res = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${jwt}` },
      body: JSON.stringify({ messages: [{ role: "user", content: prompt }] }),
    });
    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      setReply((r) => r + decoder.decode(value));
    }
    setPending(false);
  }

  return (
    <>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          const p = new FormData(e.currentTarget).get("p") as string;
          if (p) void ask(p);
        }}
      >
        <input name="p" placeholder="Ask anything" disabled={pending} style={{ width: "100%", padding: "0.5rem" }} />
      </form>
      <pre style={{ marginTop: "1rem", whiteSpace: "pre-wrap" }}>{reply}</pre>
      <button onClick={() => signOut()} style={{ marginTop: "1rem" }}>Sign out</button>
    </>
  );
}
