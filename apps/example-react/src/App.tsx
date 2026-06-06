import { useEffect, useState } from "react";
import { AuthAIProvider, SignIn, useAuthAI } from "@authai/react";
import { Chat } from "./components/Chat.js";

const RELAY_URL = import.meta.env.VITE_RELAY_URL ?? "http://localhost:3000";
const BACKEND_URL = import.meta.env.VITE_BACKEND_URL ?? "http://localhost:4000";
const THEME_KEY = "authai-demo:theme";

type Mode = "light" | "dark";

function readInitialMode(): Mode {
  if (typeof window === "undefined") return "light";
  const stored = window.localStorage.getItem(THEME_KEY);
  if (stored === "dark" || stored === "light") return stored;
  return "light";
}

export function App() {
  const [mode, setMode] = useState<Mode>(readInitialMode);
  useEffect(() => {
    try { window.localStorage.setItem(THEME_KEY, mode); } catch {}
  }, [mode]);

  return (
    <AuthAIProvider
      relayUrl={RELAY_URL}
      appName="AuthAI Demo"
      storage="localStorage"
      theme={{
        mode,
        radius: "14px",
        fontFamily:
          '"Geist", ui-sans-serif, system-ui, -apple-system, sans-serif',
      }}
    >
      <Shell mode={mode} setMode={setMode} />
    </AuthAIProvider>
  );
}

function Shell({ mode, setMode }: { mode: Mode; setMode: (m: Mode) => void }) {
  const auth = useAuthAI();
  if (auth.isSignedIn) return <SignedInShell auth={auth} />;
  return <Landing mode={mode} setMode={setMode} />;
}

function SignedInShell({ auth }: { auth: ReturnType<typeof useAuthAI> }) {
  return (
    <div className="shell">
      <header className="topbar">
        <div className="brand">AuthAI</div>
        <div className="topbar-meta">
          Demo · <strong>example-backend</strong>
        </div>
      </header>
      <div className="container">
        <Chat
          jwt={auth.jwt!}
          provider={auth.provider}
          backendUrl={BACKEND_URL}
          onSignOut={auth.signOut}
        />
      </div>
    </div>
  );
}

function Landing({ mode, setMode }: { mode: Mode; setMode: (m: Mode) => void }) {
  const toggle = () => setMode(mode === "dark" ? "light" : "dark");
  return (
    <div className="landing" data-theme={mode}>
      <header className="landing-topbar">
        <div className="landing-brand">
          <span className="landing-brand-mark">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
              <path d="M12 2 L22 20 L2 20 Z" />
            </svg>
          </span>
          AuthAI
        </div>
        <nav className="landing-nav">
          <a href="https://github.com/" target="_blank" rel="noreferrer">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
              <path d="M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.4 3-.405 1.02.005 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12" />
            </svg>
            GitHub
          </a>
          <a href="#integrate">Docs</a>
          <button
            type="button"
            className="landing-theme-toggle"
            onClick={toggle}
            aria-label={mode === "dark" ? "Switch to light mode" : "Switch to dark mode"}
            title={mode === "dark" ? "Switch to light mode" : "Switch to dark mode"}
          >
            {mode === "dark" ? <SunIcon /> : <MoonIcon />}
          </button>
        </nav>
      </header>

      <main className="landing-hero">
        <div className="landing-hero-text">
          <span className="landing-eyebrow">
            <span className="dot" />
            Auth for AI builders
          </span>

          <h1 className="landing-headline">
            Build AI products <em>without the AI bill.</em>
          </h1>

          <p className="landing-sub">
            Your users sign in with their AI subscription. <code className="landing-chip">authai.js</code> wires it into your app in two lines. Every model call lands on their plan — across ChatGPT, Grok, and Copilot.
          </p>

          <div className="landing-cta">
            <SignIn className="landing-btn-primary">
              Sign in
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <line x1="5" y1="12" x2="19" y2="12" />
                <polyline points="12 5 19 12 12 19" />
              </svg>
            </SignIn>
            <a className="landing-btn-ghost" href="https://github.com/" target="_blank" rel="noreferrer">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                <path d="M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.4 3-.405 1.02.005 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12" />
              </svg>
              View on GitHub
            </a>
          </div>

          <div className="landing-preset">
            <span>Or sign in directly</span>
            <div className="landing-preset-row">
              <SignIn provider="openai">ChatGPT</SignIn>
              <SignIn provider="xai">Grok</SignIn>
              <SignIn provider="github">Copilot</SignIn>
            </div>
          </div>
        </div>

        <CodePreview />
      </main>

      <footer className="landing-footer">
        Self-hostable · OSS · Built on the Geist of the web
      </footer>
    </div>
  );
}

function CodePreview() {
  const [tab, setTab] = useState<"frontend" | "backend">("frontend");
  return (
    <div className="landing-code" id="integrate">
      <div className="landing-code-header">
        <span className="traffic"><span /><span /><span /></span>
        <div className="landing-code-tabs">
          <button
            type="button"
            data-active={tab === "frontend"}
            onClick={() => setTab("frontend")}
          >
            frontend.jsx
          </button>
          <button
            type="button"
            data-active={tab === "backend"}
            onClick={() => setTab("backend")}
          >
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
<span className="kw">import</span> <span className="punc">{"{"}</span> <span className="var">AuthAIProvider</span><span className="punc">,</span> <span className="var">SignIn</span><span className="punc">,</span> <span className="var">useAuthAI</span> <span className="punc">{"}"}</span> <span className="kw">from</span> <span className="str">"@authai/react"</span><span className="punc">;</span>{"\n\n"}
<span className="kw">export function</span> <span className="fn">App</span><span className="punc">() {"{"}</span>{"\n"}
{"  "}<span className="com">{`// Wrap once. The provider mounts the sign-in dialog and exposes`}</span>{"\n"}
{"  "}<span className="com">{`// the session via useAuthAI() anywhere below it.`}</span>{"\n"}
{"  "}<span className="kw">return</span> <span className="punc">(</span>{"\n"}
{"    "}<span className="punc">{"<"}</span><span className="fn">AuthAIProvider</span> <span className="var">relayUrl</span><span className="punc">=</span><span className="str">"https://relay.authai.dev"</span> <span className="var">appName</span><span className="punc">=</span><span className="str">"MyApp"</span><span className="punc">{">"}</span>{"\n"}
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
<span className="kw">import</span> <span className="punc">{"{"}</span> <span className="var">authai</span> <span className="punc">{"}"}</span> <span className="kw">from</span> <span className="str">"@authai/server"</span><span className="punc">;</span>{"\n\n"}
<span className="com">{`// Next.js route handler, Express, Hono — anything that receives`}</span>{"\n"}
<span className="com">{`// the jwt from the frontend (header, cookie, body — your call).`}</span>{"\n"}
<span className="kw">export async function</span> <span className="fn">POST</span><span className="punc">(</span><span className="var">req</span><span className="punc">) {"{"}</span>{"\n"}
{"  "}<span className="kw">const</span> <span className="var">jwt</span> <span className="punc">=</span> <span className="var">req</span><span className="punc">.</span><span className="var">headers</span><span className="punc">.</span><span className="fn">get</span><span className="punc">(</span><span className="str">"authorization"</span><span className="punc">)?.</span><span className="fn">slice</span><span className="punc">(</span><span className="str">"Bearer "</span><span className="punc">.</span><span className="var">length</span><span className="punc">);</span>{"\n\n"}
{"  "}<span className="com">{`// Verify the jwt with the relay. The relay decrypts internally;`}</span>{"\n"}
{"  "}<span className="com">{`// the underlying OAuth tokens never reach your backend.`}</span>{"\n"}
{"  "}<span className="kw">const</span> <span className="punc">{"{"}</span> <span className="var">user</span><span className="punc">,</span> <span className="var">apiKey</span><span className="punc">,</span> <span className="var">baseURL</span><span className="punc">,</span> <span className="var">openai</span> <span className="punc">{"}"}</span> <span className="punc">=</span> <span className="kw">await</span> <span className="var">authai</span><span className="punc">.</span><span className="fn">session</span><span className="punc">({"{"}</span>{"\n"}
{"    "}<span className="var">jwt</span><span className="punc">,</span>{"\n"}
{"    "}<span className="var">relayUrl</span><span className="punc">:</span> <span className="str">"https://relay.authai.dev"</span><span className="punc">,</span>{"\n"}
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

function SunIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="4" />
      <line x1="12" y1="2" x2="12" y2="4" />
      <line x1="12" y1="20" x2="12" y2="22" />
      <line x1="2" y1="12" x2="4" y2="12" />
      <line x1="20" y1="12" x2="22" y2="12" />
      <line x1="4.93" y1="4.93" x2="6.34" y2="6.34" />
      <line x1="17.66" y1="17.66" x2="19.07" y2="19.07" />
      <line x1="4.93" y1="19.07" x2="6.34" y2="17.66" />
      <line x1="17.66" y1="6.34" x2="19.07" y2="4.93" />
    </svg>
  );
}

function MoonIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
    </svg>
  );
}
