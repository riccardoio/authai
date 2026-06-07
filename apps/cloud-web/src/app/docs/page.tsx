import Link from "next/link";
import { REFERENCE_MD } from "@/lib/generated/reference-md";

/**
 * docs/reference.md is the source of truth (it lives next to the OSS
 * code in the monorepo). `scripts/bake-docs.mjs` runs via the npm
 * `prebuild` lifecycle hook (and `predev` for local dev) — it copies
 * the markdown into `src/lib/generated/reference-md.ts` as a string
 * literal export. That file is git-ignored and regenerated on every
 * build.
 *
 * Result: the page imports a normal TypeScript module, Webpack ships
 * the string into the route bundle, no filesystem access at request
 * time, and Vercel deploys it without any output-tracing config.
 */
export default function DocsPage() {
  return (
    <>
      <nav className="top">
        <div>
          <strong>AuthAI Cloud</strong>
          <span className="muted"> · docs</span>
        </div>
        <div>
          <Link href="/">home</Link>
          <Link href="/dashboard">dashboard</Link>
        </div>
      </nav>
      <main>
        <p className="muted">
          The canonical version is at{" "}
          <a href="https://github.com/riccardoio/authai/blob/main/docs/reference.md">
            github.com/riccardoio/authai/blob/main/docs/reference.md
          </a>
          .
        </p>
        {REFERENCE_MD ? (
          <pre style={{ whiteSpace: "pre-wrap" }}>
            <code>{REFERENCE_MD}</code>
          </pre>
        ) : (
          <p>
            Reference doc wasn't bundled at build time. Read it on GitHub
            via the link above. (If you see this in production, the
            prebuild script failed to find docs/reference.md — check the
            Vercel build log.)
          </p>
        )}
      </main>
    </>
  );
}
