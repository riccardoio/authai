import Link from "next/link";

const GITHUB_URL = "https://github.com/riccardoio/authai";
const COMPANY = "Interface Labs Ltd";
const COMPANY_ADDRESS = "124 City Road, London, England, EC1V 2NX";
const SUPPORT_EMAIL = "support@authai.io";

/**
 * Shared footer across every public surface of the cloud webapp:
 * landing, dashboard, apps, docs, privacy, terms. Server-renderable
 * (no client hooks) so it composes inside both server and client
 * page shells. Theme inherits from the nearest [data-theme] ancestor.
 *
 * Three columns + a bottom strip:
 *
 *   - Product: GitHub, Docs, Security  (the source/integrations side)
 *   - Company: Privacy, Terms          (the legal side, required for SaaS)
 *   - Brand:   Interface Labs Ltd address + support email
 *
 * Always-present per product spec; previously the landing had a single
 * "Self-hostable · MIT" tagline and other pages had nothing. Centralising
 * here keeps legal links one edit away from being correct everywhere.
 */
export function SiteFooter() {
  const year = new Date().getFullYear();
  return (
    <footer className="site-footer">
      <div className="site-footer-inner">
        <div className="site-footer-brand">
          <Link href="/" className="site-footer-mark" aria-label="AuthAI home">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
              <path d="M12 2 L22 20 L2 20 Z" />
            </svg>
            AuthAI
          </Link>
          <p className="site-footer-tagline">
            Auth for AI builders. Your users sign in once with their AI
            subscription; every model call lands on their plan.
          </p>
          <p className="site-footer-org">
            {COMPANY} · {COMPANY_ADDRESS} ·{" "}
            <a href={`mailto:${SUPPORT_EMAIL}`} className="site-footer-link-inline">
              {SUPPORT_EMAIL}
            </a>
          </p>
        </div>

        <div className="site-footer-col">
          <h4 className="site-footer-col-title">Product</h4>
          <ul>
            <li>
              <a href={GITHUB_URL} target="_blank" rel="noreferrer">
                GitHub
              </a>
            </li>
            <li>
              <Link href="/docs/introduction">Docs</Link>
            </li>
            <li>
              <Link href="/docs/lovable">Lovable</Link>
            </li>
            <li>
              <Link href="/docs/security">Security</Link>
            </li>
          </ul>
        </div>

        <div className="site-footer-col">
          <h4 className="site-footer-col-title">Company</h4>
          <ul>
            <li>
              <Link href="/privacy">Privacy Policy</Link>
            </li>
            <li>
              <Link href="/terms">Terms of Service</Link>
            </li>
          </ul>
        </div>
      </div>

      <div className="site-footer-bottom">
        <p>
          © {year} {COMPANY}. AuthAI is open source under the MIT license.
        </p>
      </div>
    </footer>
  );
}
