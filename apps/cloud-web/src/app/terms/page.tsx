import type { Metadata } from "next";
import { PublicShell } from "../public-shell";

export const metadata: Metadata = {
  title: "Terms of Service — AuthAI",
  description:
    "Terms of Service for AuthAI, operated by Interface Labs Ltd.",
};

export default function TermsPage() {
  return (
    <PublicShell breadcrumb="Terms of Service">
      <span className="public-eyebrow">Terms of Service</span>
      <h1>Terms of Service</h1>
      <p className="public-updated">Last updated: 8 June 2026</p>

      <p className="public-lead">
        These Terms of Service (the &ldquo;Terms&rdquo;) govern your
        access to and use of AuthAI (the &ldquo;Service&rdquo;), operated
        by Interface Labs Ltd (&ldquo;Interface Labs&rdquo;,
        &ldquo;we&rdquo;, &ldquo;us&rdquo;, or &ldquo;our&rdquo;), a
        company registered in England and Wales with its registered
        office at 124 City Road, London, England, EC1V 2NX. By using the
        Service, you agree to these Terms. If you don&apos;t agree,
        please don&apos;t use the Service.
      </p>

      <Section n={1} title="The Service">
        <p>
          AuthAI is a relay that lets end users sign in to third-party
          apps with their existing ChatGPT, Grok, or Copilot subscription
          so that model calls bill against the user&apos;s plan, not the
          app developer&apos;s. The Service is offered in two delivery
          models: a managed cloud product (&ldquo;AuthAI Cloud&rdquo;)
          and an open-source self-hosted distribution
          (&ldquo;AuthAI Self-Hosted&rdquo;). These Terms apply to AuthAI
          Cloud. The Self-Hosted distribution is governed by its
          open-source MIT licence.
        </p>
      </Section>

      <Section n={2} title="Accounts">
        <p>
          You must be at least 18 years old to register an app on AuthAI
          Cloud. Builder accounts are tied to a GitHub identity; you
          are responsible for the security of your GitHub account and
          for activity that occurs through it. AuthAI does not store
          GitHub passwords.
        </p>
      </Section>

      <Section n={3} title="Apps and end users">
        <p>
          When you register an app, you receive a secret
          (<code>authai_v1_…</code>) that authorises your backend to use
          the relay. You agree to keep this secret server-side and not
          to expose it in client-side code. You are responsible for the
          conduct of your app, including the experience your end users
          have when signing in through AuthAI on your behalf.
        </p>
      </Section>

      <Section n={4} title="Acceptable use">
        <p>You agree NOT to use AuthAI to:</p>
        <ul>
          <li>
            Circumvent rate limits, abuse the providers&apos; APIs, or
            otherwise breach the AI providers&apos; own terms of service
          </li>
          <li>
            Harvest end-user OAuth tokens or attempt to extract them
            from the encrypted records the relay stores
          </li>
          <li>
            Build a service that resells access to end users&apos; AI
            subscriptions to third parties without the end users&apos;
            informed consent
          </li>
          <li>
            Probe the infrastructure for vulnerabilities outside of a
            coordinated security-research process — please email{" "}
            <a href="mailto:security@authai.io">security@authai.io</a>{" "}
            first
          </li>
          <li>
            Use the Service for any illegal purpose under UK law
          </li>
        </ul>
        <p>
          We may suspend or terminate access to apps that breach this
          section without notice.
        </p>
      </Section>

      <Section n={5} title="Pricing">
        <p>
          AuthAI Cloud is currently free to use. We reserve the right to
          introduce paid tiers in future; if we do, we will give existing
          builders at least 30 days&apos; notice and grandfather
          reasonable free usage. The Self-Hosted distribution is and
          will remain free under MIT.
        </p>
      </Section>

      <Section n={6} title="Availability and no SLA">
        <p>
          AuthAI Cloud is provided on a best-effort basis with no service
          level agreement. The Service is offered &ldquo;as is&rdquo;
          and &ldquo;as available&rdquo;. We may take the Service down
          for maintenance, security incidents, or because the operator
          (a small team) is asleep. If you need an SLA, run AuthAI
          Self-Hosted on infrastructure you control.
        </p>
      </Section>

      <Section n={7} title="Termination">
        <p>
          You may revoke any app from your dashboard at any time. We may
          terminate your access to AuthAI Cloud at any time for breach
          of these Terms or if we discontinue the service. On
          termination, we will delete your app rows and the cryptographic
          wrapping keys that make end-user encrypted records readable;
          this renders all associated end-user data permanently
          inaccessible.
        </p>
      </Section>

      <Section n={8} title="Liability">
        <p>
          To the maximum extent permitted by law, Interface Labs is not
          liable for indirect, incidental, special, consequential, or
          punitive damages, or for any loss of profits, revenue, data,
          or business opportunities, arising out of or in connection
          with the Service. Our total aggregate liability for any claim
          arising out of these Terms or use of AuthAI Cloud is limited
          to GBP 100. Nothing in these Terms limits liability for death
          or personal injury caused by negligence, fraud, or any other
          liability that cannot be excluded under UK law.
        </p>
      </Section>

      <Section n={9} title="Indemnity">
        <p>
          You agree to indemnify Interface Labs against any claim
          brought against us by a third party (including an AI provider
          whose API you accessed through the relay) arising from your
          app&apos;s misuse of the Service or breach of these Terms.
        </p>
      </Section>

      <Section n={10} title="Governing law">
        <p>
          These Terms are governed by the laws of England and Wales. Any
          dispute arising out of or in connection with these Terms or
          the Service is subject to the exclusive jurisdiction of the
          courts of England and Wales.
        </p>
      </Section>

      <Section n={11} title="Changes">
        <p>
          We&apos;ll post material changes to these Terms here and
          notify builders by email at least 14 days before they take
          effect. Continued use of the Service after that date
          constitutes acceptance.
        </p>
      </Section>

      <Section n={12} title="Contact">
        <p>
          For questions about these Terms:{" "}
          <a href="mailto:support@authai.io">support@authai.io</a>. For
          security disclosures:{" "}
          <a href="mailto:security@authai.io">security@authai.io</a>.
        </p>
      </Section>
    </PublicShell>
  );
}

function Section({
  n,
  title,
  children,
}: {
  n: number;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section>
      <h2>
        <span className="public-h2-num">{String(n).padStart(2, "0")}</span>
        {title}
      </h2>
      {children}
    </section>
  );
}
