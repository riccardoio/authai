"use client";

import Link from "next/link";
import { ThemeRoot, SunIcon, MoonIcon } from "../theme-toggle";
import { SiteFooter } from "../site-footer";

const GITHUB_URL = "https://github.com/riccardoio/authai";

type Section = { id: string; title: string; subtitle: string };
type TocEntry = { id: string; text: string };

/**
 * Shell for /docs/[slug]. Ported from apps/example-react/src/Docs.tsx —
 * same topbar, same left sidebar with sections + on-page TOC, same
 * `prose` article area for the rendered markdown.
 *
 * Client component because the theme toggle reads/writes localStorage.
 * The rendered markdown itself is passed in as `children` from the
 * server component above, so all the heavy parsing stays on the server.
 */
export function DocsShell({
  sections,
  currentSlug,
  toc,
  children,
}: {
  sections: ReadonlyArray<Section>;
  currentSlug: string;
  toc: TocEntry[];
  children: React.ReactNode;
}) {
  return (
    <ThemeRoot>
      {({ mode, toggle }) => (
        <div className="docs" data-theme={mode}>
          <header className="docs-topbar">
            <Link href="/" className="docs-brand" style={{ textDecoration: "none" }}>
              <span className="landing-brand-mark">
                <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                  <path d="M12 2 L22 20 L2 20 Z" />
                </svg>
              </span>
              AuthAI
              <span className="docs-brand-divider" aria-hidden="true">/</span>
              <span className="docs-brand-section">Docs</span>
            </Link>
            <nav className="docs-topbar-nav">
              <a href={GITHUB_URL} target="_blank" rel="noreferrer">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                  <path d="M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.4 3-.405 1.02.005 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12" />
                </svg>
                GitHub
              </a>
              <Link href="/docs/introduction" data-active={currentSlug !== "security"}>Docs</Link>
              <Link href="/docs/security" data-active={currentSlug === "security"}>Security</Link>
              <button
                type="button"
                className="docs-theme-toggle"
                onClick={toggle}
                aria-label={mode === "dark" ? "Switch to light mode" : "Switch to dark mode"}
                title={mode === "dark" ? "Switch to light mode" : "Switch to dark mode"}
              >
                {mode === "dark" ? <SunIcon /> : <MoonIcon />}
              </button>
            </nav>
          </header>

          <div className="docs-shell">
            <aside className="docs-sidebar">
              <nav>
                <p className="docs-sidebar-label">Documentation</p>
                {sections.map((s) => (
                  <Link
                    key={s.id}
                    href={`/docs/${s.id}`}
                    data-active={s.id === currentSlug}
                    className="docs-sidebar-link"
                  >
                    <span className="docs-sidebar-title">{s.title}</span>
                    <span className="docs-sidebar-subtitle">{s.subtitle}</span>
                  </Link>
                ))}
              </nav>

              {toc.length > 0 && (
                <div className="docs-sidebar-toc">
                  <p className="docs-sidebar-label">On this page</p>
                  {toc.map((t) => (
                    <a key={t.id} href={`#${t.id}`} className="docs-toc-link">
                      {t.text}
                    </a>
                  ))}
                </div>
              )}
            </aside>

            <main className="docs-content">{children}</main>
          </div>
          <SiteFooter />
        </div>
      )}
    </ThemeRoot>
  );
}
