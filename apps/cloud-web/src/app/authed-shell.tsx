"use client";

import Link from "next/link";
import { ThemeRoot, SunIcon, MoonIcon } from "./theme-toggle";
import { SiteFooter } from "./site-footer";

/**
 * Shared chrome for authenticated pages (/dashboard, /apps/*). Same
 * font + tokens + topbar pattern as the landing + docs viewer so the
 * whole webapp feels like one product. Theme toggle persists across
 * routes via the ThemeRoot's localStorage.
 */
export function AuthedShell({
  githubLogin,
  breadcrumb,
  children,
}: {
  githubLogin?: string;
  breadcrumb?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <ThemeRoot>
      {({ mode, toggle }) => (
        <div className="authed-shell" data-theme={mode}>
          <header className="authed-topbar">
            <Link href="/dashboard" className="authed-brand" style={{ textDecoration: "none" }}>
              <span className="landing-brand-mark">
                <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                  <path d="M12 2 L22 20 L2 20 Z" />
                </svg>
              </span>
              AuthAI
              {breadcrumb && (
                <>
                  <span className="authed-brand-divider" aria-hidden="true">/</span>
                  <span className="authed-brand-section">{breadcrumb}</span>
                </>
              )}
            </Link>
            <nav className="authed-nav">
              <Link href="/docs/introduction">Docs</Link>
              {githubLogin && (
                <span className="authed-user">@{githubLogin}</span>
              )}
              <a className="authed-signout" href="/api/auth/sign-out">
                Sign out
              </a>
              <button
                type="button"
                className="authed-theme-toggle"
                onClick={toggle}
                aria-label={mode === "dark" ? "Switch to light mode" : "Switch to dark mode"}
                title={mode === "dark" ? "Switch to light mode" : "Switch to dark mode"}
              >
                {mode === "dark" ? <SunIcon /> : <MoonIcon />}
              </button>
            </nav>
          </header>
          <main className="authed-content">{children}</main>
          <SiteFooter />
        </div>
      )}
    </ThemeRoot>
  );
}
