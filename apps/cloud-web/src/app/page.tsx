"use client";

import Link from "next/link";
import { CodePreview } from "./code-preview";
import { ThemeRoot, SunIcon, MoonIcon } from "./theme-toggle";

const GITHUB_URL = "https://github.com/riccardoio/authai";

/**
 * Landing page for authai.io. Adapted from apps/example-react/src/App.tsx's
 * Landing — same hero shape, same CTAs visually, but rewired for the
 * webapp context:
 *
 *   - "Try it" / multi-provider SignIn buttons (which signed END USERS
 *     into ChatGPT in the demo) are replaced with "Sign in with GitHub"
 *     pointing at /sign-in. The audience here is BUILDERS signing in to
 *     register an app; end-user ChatGPT sign-in happens later inside
 *     each builder's own app via @authai/react's SignIn widget.
 *   - Hash-routing (#/docs/...) becomes Next.js <Link href="/docs/...">.
 *   - The GitHub link points at the real repo, not a placeholder.
 *
 * Client component because the theme toggle needs localStorage. Could
 * be split into a server-rendered shell with a small client island just
 * for the toggle, but the whole page is small enough that the cost is
 * negligible and a single client component keeps the code linear.
 */
export default function HomePage() {
  return (
    <ThemeRoot>
      {({ mode, toggle }) => (
        <div className="landing" data-theme={mode}>
          <header className="landing-topbar">
            <Link href="/" className="landing-brand" style={{ textDecoration: "none" }}>
              <span className="landing-brand-mark">
                <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                  <path d="M12 2 L22 20 L2 20 Z" />
                </svg>
              </span>
              AuthAI
            </Link>
            <nav className="landing-nav">
              <a href={GITHUB_URL} target="_blank" rel="noreferrer">
                <GithubIcon />
                GitHub
              </a>
              <Link href="/docs/introduction">Docs</Link>
              <Link href="/docs/security">Security</Link>
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
                Auth for AI builders
              </span>

              <h1 className="landing-headline">
                Build AI products <em>without the AI bill.</em>
              </h1>

              <p className="landing-sub">
                Your users sign in once with their ChatGPT, Grok, or Copilot
                subscription. Your backend keeps using the{" "}
                <code className="landing-chip">openai</code> SDK. Just point{" "}
                <code className="landing-chip">baseURL</code> at the relay.
                Every model call lands on the user's plan, not yours.
              </p>

              <div className="landing-cta">
                <a className="landing-btn-ghost" href={GITHUB_URL} target="_blank" rel="noreferrer">
                  <GithubIcon />
                  Source on GitHub
                </a>
                <Link href="/sign-in" className="landing-btn-primary">
                  Get started
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                    strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <line x1="5" y1="12" x2="19" y2="12" />
                    <polyline points="12 5 19 12 12 19" />
                  </svg>
                </Link>
              </div>

              <div className="landing-preset">
                <span>Or in your terminal</span>
                <div className="landing-preset-row">
                  <code style={{
                    fontFamily: "var(--font-mono)",
                    fontSize: 13,
                    padding: "8px 14px",
                    borderRadius: 999,
                    border: "1px solid var(--border-strong)",
                  }}>npx authai-cloud init</code>
                </div>
                <span
                  style={{
                    fontSize: 12,
                    color: "var(--text-faint)",
                    marginTop: 8,
                  }}
                >
                  ~30 seconds. Writes <code style={{ fontFamily: "var(--font-mono)", fontSize: 11 }}>AUTH_AI_SECRET</code>{" "}
                  to your <code style={{ fontFamily: "var(--font-mono)", fontSize: 11 }}>.env</code>.
                </span>
              </div>

            </div>

            <CodePreview />
          </main>

          <section className="landing-trust-band" aria-label="Security">
            <p className="landing-trust">
              <LockIcon />
              End-to-end encrypted. The relay holds ciphertext only, never the
              keys to decrypt it.{" "}
              <Link href="/docs/security" className="landing-trust-link">
                Read the security model →
              </Link>
            </p>
          </section>

          <section className="landing-flow" aria-labelledby="how-it-works">
            <h2 id="how-it-works" className="landing-flow-heading">
              How it works
            </h2>
            <ol className="landing-flow-steps">
              <li className="landing-flow-step">
                <span className="landing-flow-num">1</span>
                <h3 className="landing-flow-step-title">Your user signs in</h3>
                <p className="landing-flow-step-body">
                  One button. ChatGPT, Grok, or Copilot — whichever subscription
                  they already pay for. 30-second OAuth on the provider's site.
                </p>
              </li>
              <li className="landing-flow-step">
                <span className="landing-flow-num">2</span>
                <h3 className="landing-flow-step-title">Your backend gets a JWT</h3>
                <p className="landing-flow-step-body">
                  Use it like an API key. The <code>openai</code> SDK keeps
                  working. Point <code>baseURL</code> at the relay and the
                  rest of your code is unchanged.
                </p>
              </li>
              <li className="landing-flow-step">
                <span className="landing-flow-num">3</span>
                <h3 className="landing-flow-step-title">Calls land on their plan</h3>
                <p className="landing-flow-step-body">
                  Every model call bills against the user's subscription, not
                  yours. Tokens stay encrypted end-to-end; the relay holds
                  ciphertext, never plaintext.
                </p>
              </li>
            </ol>
          </section>

          <footer className="landing-footer">
            Self-hostable · MIT licensed ·{" "}
            <a href={GITHUB_URL} target="_blank" rel="noreferrer">
              github.com/riccardoio/authai
            </a>
          </footer>
        </div>
      )}
    </ThemeRoot>
  );
}

function GithubIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.4 3-.405 1.02.005 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12" />
    </svg>
  );
}

function LockIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
      <path d="M7 11V7a5 5 0 0 1 10 0v4" />
    </svg>
  );
}
