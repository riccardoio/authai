"use client";

import { useState } from "react";

/**
 * The "frontend.jsx / backend.js" tabbed code panel from the landing.
 * Ported verbatim from apps/demo-react/src/App.tsx — the syntax
 * highlighting is done via inline <span> classes (kw/var/str/fn/com/punc)
 * which the global stylesheet styles. No marked/highlight.js needed for
 * these two snippets; they're hand-tokenized to match the design exactly.
 */
export function CodePreview() {
  const [tab, setTab] = useState<"frontend" | "backend">("frontend");
  return (
    <div className="landing-code" id="integrate">
      <div className="landing-code-header">
        <span className="traffic"><span /><span /><span /></span>
        <div className="landing-code-tabs">
          <button type="button" data-active={tab === "frontend"} onClick={() => setTab("frontend")}>
            frontend.jsx
          </button>
          <button type="button" data-active={tab === "backend"} onClick={() => setTab("backend")}>
            backend.js
          </button>
        </div>
      </div>
      {tab === "frontend" ? <FrontendSnippet /> : <BackendSnippet />}
    </div>
  );
}

function FrontendSnippet() {
  return (
    <pre>
<span className="kw">import</span> <span className="punc">{"{"}</span> <span className="var">AuthAIProvider</span><span className="punc">,</span> <span className="var">SignIn</span><span className="punc">,</span> <span className="var">useAuthAI</span> <span className="punc">{"}"}</span> <span className="kw">from</span> <span className="str">"@authai-io/react"</span><span className="punc">;</span>{"\n\n"}
<span className="kw">export function</span> <span className="fn">App</span><span className="punc">() {"{"}</span>{"\n"}
{"  "}<span className="com">{`// Wrap once. The provider mounts the sign-in dialog and exposes`}</span>{"\n"}
{"  "}<span className="com">{`// the session via useAuthAI() anywhere below it.`}</span>{"\n"}
{"  "}<span className="kw">return</span> <span className="punc">(</span>{"\n"}
{"    "}<span className="punc">{"<"}</span><span className="fn">AuthAIProvider</span> <span className="var">relayUrl</span><span className="punc">=</span><span className="str">"https://relay.authai.io"</span> <span className="var">appName</span><span className="punc">=</span><span className="str">"MyApp"</span><span className="punc">{">"}</span>{"\n"}
{"      "}<span className="punc">{"<"}</span><span className="fn">Chat</span> <span className="punc">/{">"}</span>{"\n"}
{"    "}<span className="punc">{"</"}</span><span className="fn">AuthAIProvider</span><span className="punc">{">"}</span>{"\n"}
{"  "}<span className="punc">);</span>{"\n"}
<span className="punc">{"}"}</span>{"\n\n"}
<span className="kw">function</span> <span className="fn">Chat</span><span className="punc">() {"{"}</span>{"\n"}
{"  "}<span className="kw">const</span> <span className="punc">{"{"}</span> <span className="var">jwt</span><span className="punc">,</span> <span className="var">isSignedIn</span> <span className="punc">{"}"}</span> <span className="punc">=</span> <span className="fn">useAuthAI</span><span className="punc">();</span>{"\n"}
{"  "}<span className="kw">if</span> <span className="punc">(!</span><span className="var">isSignedIn</span><span className="punc">)</span> <span className="kw">return</span> <span className="punc">{"<"}</span><span className="fn">SignIn</span> <span className="punc">/{">"}</span><span className="punc">;</span>{"\n\n"}
{"  "}<span className="com">{`// jwt is the user's session — opaque to you. Send it to your backend`}</span>{"\n"}
{"  "}<span className="com">{`// however you usually send auth (header, cookie, body).`}</span>{"\n"}
<span className="punc">{"}"}</span>
    </pre>
  );
}

function BackendSnippet() {
  return (
    <pre>
<span className="kw">import</span> <span className="punc">{"{"}</span> <span className="var">authai</span> <span className="punc">{"}"}</span> <span className="kw">from</span> <span className="str">"@authai-io/server"</span><span className="punc">;</span>{"\n\n"}
<span className="com">{`// Next.js route handler, Express, Hono — anything that receives`}</span>{"\n"}
<span className="com">{`// the jwt from the frontend (header, cookie, body — your call).`}</span>{"\n"}
<span className="kw">export async function</span> <span className="fn">POST</span><span className="punc">(</span><span className="var">req</span><span className="punc">) {"{"}</span>{"\n"}
{"  "}<span className="kw">const</span> <span className="var">jwt</span> <span className="punc">=</span> <span className="var">req</span><span className="punc">.</span><span className="var">headers</span><span className="punc">.</span><span className="fn">get</span><span className="punc">(</span><span className="str">"authorization"</span><span className="punc">)?.</span><span className="fn">slice</span><span className="punc">(</span><span className="str">"Bearer "</span><span className="punc">.</span><span className="var">length</span><span className="punc">);</span>{"\n\n"}
{"  "}<span className="com">{`// Verify the jwt with the relay. The relay decrypts internally;`}</span>{"\n"}
{"  "}<span className="com">{`// the underlying OAuth tokens never reach your backend.`}</span>{"\n"}
{"  "}<span className="kw">const</span> <span className="punc">{"{"}</span> <span className="var">user</span><span className="punc">,</span> <span className="var">apiKey</span><span className="punc">,</span> <span className="var">baseURL</span><span className="punc">,</span> <span className="var">openai</span> <span className="punc">{"}"}</span> <span className="punc">=</span> <span className="kw">await</span> <span className="var">authai</span><span className="punc">.</span><span className="fn">session</span><span className="punc">({"{"}</span>{"\n"}
{"    "}<span className="var">jwt</span><span className="punc">,</span>{"\n"}
{"    "}<span className="var">relayUrl</span><span className="punc">:</span> <span className="str">"https://relay.authai.io"</span><span className="punc">,</span>{"\n"}
{"  "}<span className="punc">{"}"});</span>{"\n\n"}
{"  "}<span className="com">{`// user.id        — opaque, stable across re-sign-ins, namespaced per provider`}</span>{"\n"}
{"  "}<span className="com">{`// user.provider  — "openai" | "xai" | "github"`}</span>{"\n"}
{"  "}<span className="com">{`// openai         — pre-configured client; bill lands on the user's plan`}</span>{"\n"}
{"  "}<span className="com">{`// apiKey/baseURL — wire LangChain, AI SDK, or any custom client instead`}</span>{"\n"}
{"  "}<span className="kw">const</span> <span className="var">stream</span> <span className="punc">=</span> <span className="kw">await</span> <span className="var">openai</span><span className="punc">.</span><span className="var">chat</span><span className="punc">.</span><span className="var">completions</span><span className="punc">.</span><span className="fn">create</span><span className="punc">({"{"}</span>{"\n"}
{"    "}<span className="var">model</span><span className="punc">:</span> <span className="str">"gpt-5.4"</span><span className="punc">,</span>{"\n"}
{"    "}<span className="var">messages</span><span className="punc">,</span>{"\n"}
{"    "}<span className="var">stream</span><span className="punc">:</span> <span className="kw">true</span><span className="punc">,</span>{"\n"}
{"  "}<span className="punc">{"}"});</span>{"\n"}
{"  "}<span className="kw">return</span> <span className="kw">new</span> <span className="fn">Response</span><span className="punc">(</span><span className="var">stream</span><span className="punc">.</span><span className="fn">toReadableStream</span><span className="punc">());</span>{"\n"}
<span className="punc">{"}"}</span>
    </pre>
  );
}
