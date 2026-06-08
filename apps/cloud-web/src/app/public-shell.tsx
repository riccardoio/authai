"use client";

import Link from "next/link";
import { ThemeRoot, SunIcon, MoonIcon } from "./theme-toggle";
import { SiteFooter } from "./site-footer";

/**
 * Shell for public static pages (privacy, terms). Slimmer than the
 * landing or docs shell: just brand + theme toggle in the topbar,
 * a prose-width content column, and the shared SiteFooter. The
 * topbar's navigation lives in the footer here — these pages get
 * arrived at FROM the footer, so duplicating those links above the
 * fold would be redundant.
 *
 * Client because the theme toggle needs localStorage. The children
 * passed in are still server-rendered.
 */
export function PublicShell({
  breadcrumb,
  children,
}: {
  breadcrumb: string;
  children: React.ReactNode;
}) {
  return (
    <ThemeRoot>
      {({ mode, toggle }) => (
        <div className="public-shell" data-theme={mode}>
          <header className="public-topbar">
            <Link href="/" className="public-brand">
              <span className="landing-brand-mark">
                <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                  <path d="M12 2 L22 20 L2 20 Z" />
                </svg>
              </span>
              AuthAI
              <span className="public-brand-divider" aria-hidden="true">/</span>
              <span className="public-brand-section">{breadcrumb}</span>
            </Link>
            <button
              type="button"
              className="public-theme-toggle"
              onClick={toggle}
              aria-label={mode === "dark" ? "Switch to light mode" : "Switch to dark mode"}
              title={mode === "dark" ? "Switch to light mode" : "Switch to dark mode"}
            >
              {mode === "dark" ? <SunIcon /> : <MoonIcon />}
            </button>
          </header>

          <main className="public-content">{children}</main>

          <SiteFooter />
        </div>
      )}
    </ThemeRoot>
  );
}
