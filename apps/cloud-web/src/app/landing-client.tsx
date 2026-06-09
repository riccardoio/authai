"use client";

import Link from "next/link";
import { CodePreview } from "./code-preview";
import { ThemeRoot, SunIcon, MoonIcon } from "./theme-toggle";
import { SiteFooter } from "./site-footer";
import { TerminalSnippet } from "./terminal-snippet";

const GITHUB_URL = "https://github.com/authai-io/authai";
const DEMO_URL = "https://demo.authai.io";

type SessionShape = {
  githubLogin: string;
} | null;

/**
 * Landing client island. Receives the builder session from the
 * Server Component above (page.tsx) so we can swap the topbar nav
 * between the public-marketing variant (GitHub / Docs / Security)
 * and the signed-in-builder variant (avatar + login + Manage apps).
 *
 * Public docs/security/github links don't disappear when signed in
 * — they're still in the SiteFooter at the bottom of every page.
 * The topbar real-estate is more valuable for the active builder's
 * "I'm signed in, take me to my apps" affordance.
 *
 * Client because the theme toggle reads/writes localStorage. The
 * SiteFooter rendered below is itself a server-renderable component
 * so the actual link list ships statically; only the topbar nav is
 * actually re-rendered client-side per session state.
 */
export function LandingClient({ session }: { session: SessionShape }) {
  return (
    <ThemeRoot>
      {({ mode, toggle }) => (
        <div className="landing" data-theme={mode}>
          <a
            className="landing-announce"
            href="mailto:riccardo@interfacelabs.ai?subject=Saw%20AuthAI%20-%20what%20next%3F"
          >
            <span className="landing-announce-dot" aria-hidden="true" />
            <span className="landing-announce-text">
              <strong>Enjoying AuthAI?</strong> Something more ambitious is in
              the works. Get in touch
            </span>
            <svg
              width="12"
              height="12"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.4"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <line x1="5" y1="12" x2="19" y2="12" />
              <polyline points="12 5 19 12 12 19" />
            </svg>
          </a>
          <header className="landing-topbar">
            <Link href="/" className="landing-brand" style={{ textDecoration: "none" }}>
              <span className="landing-brand-mark">
                <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                  <rect x="0" y="0" width="10" height="10" rx="2" />
                  <rect x="14" y="14" width="10" height="10" rx="2" />
                  <rect x="7" y="7" width="10" height="10" rx="2" fill="none" stroke="currentColor" strokeWidth="1.5" />
                </svg>
              </span>
              AuthAI
            </Link>
            <nav className="landing-nav">
              {session ? (
                <SignedInNav login={session.githubLogin} mode={mode} toggle={toggle} />
              ) : (
                <PublicNav mode={mode} toggle={toggle} />
              )}
            </nav>
          </header>

          <main className="landing-hero">
            <div className="landing-hero-text">
              <span className="landing-eyebrow">Open source AI auth for builders</span>

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
                <Link
                  href={session ? "/dashboard" : "/sign-in"}
                  className="landing-btn-primary"
                >
                  {session ? "Open dashboard" : "Get started"}
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                    strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <line x1="5" y1="12" x2="19" y2="12" />
                    <polyline points="12 5 19 12 12 19" />
                  </svg>
                </Link>
              </div>

              <div className="landing-preset">
                <span className="landing-preset-label">Or in your terminal</span>
                <TerminalSnippet command="npx authai-cloud init" />
              </div>
            </div>

            <CodePreview />
          </main>

          <section className="landing-flow" aria-labelledby="how-it-works">
            <h2 id="how-it-works" className="landing-flow-heading">
              How it works
            </h2>
            <ol className="landing-flow-steps">
              <li className="landing-flow-step">
                <span className="landing-flow-num">1</span>
                <h3 className="landing-flow-step-title">Your user signs in</h3>
                <p className="landing-flow-step-body">
                  One button. ChatGPT, Grok, or Copilot. Whichever subscription
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
                  Every model call bills against the user's subscription,
                  not yours. We never see their AI tokens. They&apos;re
                  encrypted before they reach us.
                </p>
              </li>
            </ol>
          </section>

          <section className="landing-demo-band" aria-label="Live demo">
            <a
              href={DEMO_URL}
              target="_blank"
              rel="noreferrer"
              className="landing-demo-link"
            >
              <PlayIcon />
              <span>
                <strong>Try the live demo.</strong> Sign in with ChatGPT and
                chat for free at <code>demo.authai.io</code>
              </span>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <line x1="5" y1="12" x2="19" y2="12" />
                <polyline points="12 5 19 12 12 19" />
              </svg>
            </a>
          </section>

          <section className="landing-platforms" aria-labelledby="platforms-heading">
            <h2 id="platforms-heading" className="landing-platforms-label">
              Works with every AI coding tool
            </h2>
            <div className="landing-platforms-row">
              <a
                className="landing-platform"
                href="/docs/lovable"
                aria-label="Lovable integration guide"
              >
                <img
                  src="/brands/lovable.svg"
                  alt=""
                  width={32}
                  height={32}
                  className="landing-platform-mark"
                />
                <span>Lovable</span>
              </a>
              <a
                className="landing-platform"
                href="https://v0.app"
                target="_blank"
                rel="noreferrer"
                aria-label="v0 by Vercel"
              >
                <svg
                  width="32"
                  height="32"
                  viewBox="0 0 76 65"
                  fill="currentColor"
                  className="landing-platform-mark"
                  aria-hidden="true"
                >
                  <path d="M37.59.25l36.95 64H.64z" />
                </svg>
                <span>v0</span>
              </a>
              <a
                className="landing-platform"
                href="https://bolt.new"
                target="_blank"
                rel="noreferrer"
                aria-label="Bolt.new by StackBlitz"
              >
                <img
                  src="/brands/bolt.svg"
                  alt=""
                  width={32}
                  height={32}
                  className="landing-platform-mark"
                />
                <span>Bolt</span>
              </a>
              <a
                className="landing-platform"
                href="https://cursor.com"
                target="_blank"
                rel="noreferrer"
                aria-label="Cursor"
              >
                <img
                  src="/brands/cursor.svg"
                  alt=""
                  width={32}
                  height={32}
                  className="landing-platform-mark"
                />
                <span>Cursor</span>
              </a>
              <a
                className="landing-platform"
                href="https://claude.com/claude-code"
                target="_blank"
                rel="noreferrer"
                aria-label="Claude Code by Anthropic"
              >
                <img
                  src="/brands/claude.svg"
                  alt=""
                  width={32}
                  height={32}
                  className="landing-platform-mark"
                />
                <span>Claude Code</span>
              </a>
            </div>
            <p className="landing-platforms-hint">
              Tell their AI: <em>“Read https://authai.io/llms.txt”</em>. It
              generates the integration for you.
            </p>
          </section>

          <section className="landing-security" aria-labelledby="security-heading">
            <div className="landing-security-inner">
              <h2 id="security-heading" className="landing-security-headline">
                <LockIcon />
                We can&apos;t read your users&apos; AI tokens.
              </h2>
              <p className="landing-security-sub">
                Every user&apos;s OAuth credentials are encrypted with a
                fresh per-record AES-256 key. That key never lives on our
                servers. It&apos;s embedded in the JWT issued to the user.
                A full database leak still leaves the credentials opaque.
              </p>
              <Link href="/docs/security" className="landing-security-link">
                Read the security model
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                  strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <line x1="5" y1="12" x2="19" y2="12" />
                  <polyline points="12 5 19 12 12 19" />
                </svg>
              </Link>
            </div>
          </section>

          <section className="landing-why" aria-labelledby="why-heading">
            <h2 id="why-heading" className="landing-why-heading">
              Why developers use AuthAI
            </h2>
            <div className="landing-why-grid">
              <article className="landing-why-card">
                <span className="landing-why-icon" aria-hidden="true">
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                    strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                    <line x1="12" y1="1" x2="12" y2="23" />
                    <path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" />
                  </svg>
                </span>
                <h3 className="landing-why-card-title">Zero inference cost</h3>
                <p className="landing-why-card-body">
                  Users bring their own ChatGPT, Grok, or Copilot
                  subscription. Your bill doesn&apos;t scale with usage.
                  Theirs does.
                </p>
              </article>
              <article className="landing-why-card">
                <span className="landing-why-icon" aria-hidden="true">
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                    strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="16 18 22 12 16 6" />
                    <polyline points="8 6 2 12 8 18" />
                  </svg>
                </span>
                <h3 className="landing-why-card-title">Drop-in OpenAI SDK</h3>
                <p className="landing-why-card-body">
                  Point <code>baseURL</code> at the relay. Keep the{" "}
                  <code>openai</code> SDK. The rest of your code is
                  unchanged.
                </p>
              </article>
              <article className="landing-why-card">
                <span className="landing-why-icon" aria-hidden="true">
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                    strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
                    <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
                  </svg>
                </span>
                <h3 className="landing-why-card-title">Open source, MIT</h3>
                <p className="landing-why-card-body">
                  Self-hostable from day one. No vendor lock-in.
                  The cloud is a convenience, not a moat.
                </p>
              </article>
            </div>
          </section>

          <section className="landing-runways" aria-labelledby="runways-heading">
            <h2 id="runways-heading" className="landing-runways-heading">
              Two ways to run it
            </h2>
            <div className="landing-runways-grid">
              <article className="landing-runway">
                <span className="landing-runway-tag">AuthAI Cloud</span>
                <h3 className="landing-runway-title">Hosted, free</h3>
                <p className="landing-runway-body">
                  We run the relay at <code>relay.authai.io</code>. You write
                  zero infra. Sign in with GitHub, create an app, get a key.
                  About 30 seconds.
                </p>
                <Link
                  href={session ? "/dashboard" : "/sign-in"}
                  className="landing-runway-cta"
                >
                  {session ? "Open dashboard" : "Get a key"}
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                    strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <line x1="5" y1="12" x2="19" y2="12" />
                    <polyline points="12 5 19 12 12 19" />
                  </svg>
                </Link>
              </article>
              <article className="landing-runway">
                <span className="landing-runway-tag">Self-hosted</span>
                <h3 className="landing-runway-title">Your servers, your data</h3>
                <p className="landing-runway-body">
                  MIT licensed. <code>docker compose up</code> and you own the
                  whole stack. Postgres + Redis, no external service required.
                </p>
                <Link href="/docs/installation" className="landing-runway-cta">
                  Read the install docs
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                    strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <line x1="5" y1="12" x2="19" y2="12" />
                    <polyline points="12 5 19 12 12 19" />
                  </svg>
                </Link>
              </article>
            </div>
          </section>

          <SiteFooter />
        </div>
      )}
    </ThemeRoot>
  );
}

function PublicNav({
  mode,
  toggle,
}: {
  mode: "light" | "dark";
  toggle: () => void;
}) {
  return (
    <>
      <a href={DEMO_URL} target="_blank" rel="noreferrer">Demo</a>
      <a href={GITHUB_URL} target="_blank" rel="noreferrer">
        <GithubIcon />
        GitHub
      </a>
      <Link href="/docs/introduction">Docs</Link>
      <Link href="/docs/security">Security</Link>
      <ThemeToggleButton mode={mode} toggle={toggle} />
    </>
  );
}

function SignedInNav({
  login,
  mode,
  toggle,
}: {
  login: string;
  mode: "light" | "dark";
  toggle: () => void;
}) {
  return (
    <>
      <a href={DEMO_URL} target="_blank" rel="noreferrer">Demo</a>
      <span className="landing-user">
        {/*
          GitHub serves the avatar from the canonical
          https://github.com/<login>.png endpoint — no API call, no
          auth, redirects to the user's current avatar URL. 28px
          rendered, request a 2× for retina.
        */}
        <img
          src={`https://github.com/${login}.png?size=56`}
          alt=""
          width={20}
          height={20}
          className="landing-user-avatar"
        />
        @{login}
      </span>
      <Link href="/dashboard" className="landing-user-action">
        Manage apps
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor"
          strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <line x1="5" y1="12" x2="19" y2="12" />
          <polyline points="12 5 19 12 12 19" />
        </svg>
      </Link>
      <ThemeToggleButton mode={mode} toggle={toggle} />
    </>
  );
}

function ThemeToggleButton({
  mode,
  toggle,
}: {
  mode: "light" | "dark";
  toggle: () => void;
}) {
  return (
    <button
      type="button"
      className="landing-theme-toggle"
      onClick={toggle}
      aria-label={mode === "dark" ? "Switch to light mode" : "Switch to dark mode"}
      title={mode === "dark" ? "Switch to light mode" : "Switch to dark mode"}
    >
      {mode === "dark" ? <SunIcon /> : <MoonIcon />}
    </button>
  );
}

function GithubIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.4 3-.405 1.02.005 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12" />
    </svg>
  );
}

function PlayIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M8 5v14l11-7z" />
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
