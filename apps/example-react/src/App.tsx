import { useEffect, useState } from "react";
import { AuthAIProvider, SignIn, useAuthAI } from "@authai/react";
import { Chat } from "./components/Chat.js";

const RELAY_URL = import.meta.env.VITE_RELAY_URL ?? "https://relay.authai.io";
// Empty string = same-origin. The prod build serves the SPA AND the API
// from the same domain (demo.authai.io), so the browser's relative fetches
// hit the Hono backend without needing a host. Override only when running
// the Vite dev server against a backend on a different port.
const BACKEND_URL = import.meta.env.VITE_BACKEND_URL ?? "";
const THEME_KEY = "authai-demo:theme";

type Mode = "light" | "dark";

function readInitialMode(): Mode {
  if (typeof window === "undefined") return "light";
  const stored = window.localStorage.getItem(THEME_KEY);
  if (stored === "dark" || stored === "light") return stored;
  return window.matchMedia?.("(prefers-color-scheme: dark)").matches
    ? "dark"
    : "light";
}

export function App() {
  const [mode, setMode] = useState<Mode>(readInitialMode);

  useEffect(() => {
    try { window.localStorage.setItem(THEME_KEY, mode); } catch {}
    document.documentElement.dataset.theme = mode;
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
  if (auth.isSignedIn) {
    return <ChatShell auth={auth} mode={mode} setMode={setMode} />;
  }
  return <SignInScreen mode={mode} setMode={setMode} />;
}

function SignInScreen({
  mode,
  setMode,
}: {
  mode: Mode;
  setMode: (m: Mode) => void;
}) {
  const toggle = () => setMode(mode === "dark" ? "light" : "dark");
  return (
    <div className="signin-screen" data-theme={mode}>
      <header className="signin-topbar">
        <div className="signin-brand">
          <span className="signin-brand-mark">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
              <path d="M12 2 L22 20 L2 20 Z" />
            </svg>
          </span>
          <span className="signin-brand-text">
            Demo App by{" "}
            <a
              href="https://authai.io"
              className="signin-brand-link"
              target="_blank"
              rel="noreferrer"
            >
              authai.io
            </a>
          </span>
        </div>
        <button
          type="button"
          className="signin-theme-toggle"
          onClick={toggle}
          aria-label={mode === "dark" ? "Switch to light mode" : "Switch to dark mode"}
        >
          {mode === "dark" ? <SunIcon /> : <MoonIcon />}
        </button>
      </header>

      <main className="signin-main">
        <div className="signin-card">
          <h1 className="signin-headline">
            Sign in with your <em>AI subscription.</em>
          </h1>
          <p className="signin-sub">
            This demo runs on AuthAI. The chat below will use{" "}
            <strong>your</strong> ChatGPT, Grok, or Copilot plan. Never ours.
            Tokens stay encrypted; we hold ciphertext only.
          </p>

          <div className="signin-providers">
            <SignIn provider="openai">
              <ProviderMark id="openai" />
              Continue with ChatGPT
            </SignIn>
            <SignIn provider="xai">
              <ProviderMark id="xai" />
              Continue with Grok
            </SignIn>
            <SignIn provider="github">
              <ProviderMark id="github" />
              Continue with Copilot
            </SignIn>
          </div>

          <p className="signin-footnote">
            Open source ·{" "}
            <a href="https://github.com/riccardoio/authai" target="_blank" rel="noreferrer">
              github.com/riccardoio/authai
            </a>
          </p>
        </div>
      </main>
    </div>
  );
}

function ChatShell({
  auth,
  mode,
  setMode,
}: {
  auth: ReturnType<typeof useAuthAI>;
  mode: Mode;
  setMode: (m: Mode) => void;
}) {
  const toggle = () => setMode(mode === "dark" ? "light" : "dark");
  return (
    <div className="chat-shell" data-theme={mode}>
      <header className="chat-topbar">
        <div className="chat-brand">
          <span className="chat-brand-mark">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
              <path d="M12 2 L22 20 L2 20 Z" />
            </svg>
          </span>
          <span className="chat-brand-text">
            Demo App by{" "}
            <a
              href="https://authai.io"
              className="chat-brand-link"
              target="_blank"
              rel="noreferrer"
            >
              authai.io
            </a>
          </span>
        </div>
        <button
          type="button"
          className="chat-theme-toggle"
          onClick={toggle}
          aria-label={mode === "dark" ? "Switch to light mode" : "Switch to dark mode"}
        >
          {mode === "dark" ? <SunIcon /> : <MoonIcon />}
        </button>
      </header>

      <div className="chat-frame">
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

function ProviderMark({ id }: { id: "openai" | "xai" | "github" }) {
  if (id === "openai") {
    return (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
        <path d="M22.282 9.821a5.985 5.985 0 0 0-.516-4.91 6.046 6.046 0 0 0-6.51-2.9A6.065 6.065 0 0 0 4.981 4.18a5.985 5.985 0 0 0-3.998 2.9 6.046 6.046 0 0 0 .743 7.097 5.98 5.98 0 0 0 .51 4.911 6.051 6.051 0 0 0 6.515 2.9A5.985 5.985 0 0 0 13.26 24a6.056 6.056 0 0 0 5.772-4.206 5.99 5.99 0 0 0 3.997-2.9 6.056 6.056 0 0 0-.747-7.073z" />
      </svg>
    );
  }
  if (id === "xai") {
    return (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
        <path d="M3 2h4.5l4.5 6.5L16.5 2H21l-7 10 7 10h-4.5L12 15.5 7.5 22H3l7-10z" />
      </svg>
    );
  }
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.4 3-.405 1.02.005 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12" />
    </svg>
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
