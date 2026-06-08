import Link from "next/link";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { getStore } from "@/lib/db";
import { readOneTimeKey } from "@/lib/one-time-key";
import { AutoSubmit } from "./auto-submit";
import { CopySnippetButton } from "./copy-snippet-button";
import { AuthedShell } from "../../../authed-shell";
import type { AppRow } from "@authai/relay-store-postgres";
import { renderSupabaseEdgeTemplate } from "@/lib/edge-templates/supabase";

/**
 * `/apps/[id]/created` — the one-time post-create page.
 *
 * Secret apps: the API key arrives via an HttpOnly one-time cookie set by
 * the Create-App server action; this page reads it and either renders the
 * secret in a code block (web flow) or embeds it in a POST form
 * auto-submitted to the CLI listener (CLI flow). Cookie auto-expires in 5
 * minutes.
 *
 * Publishable apps: the publishable key is passed as `?pk=…` in the URL.
 * It's browser-safe (origin-pinned, not a secret) so URL carriage is
 * acceptable here. The key is still shown only once with copy affordance.
 */
export default async function CreatedPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ type?: string; pk?: string; cli?: string; port?: string; state?: string; template?: string }>;
}) {
  const session = await getSession();
  if (!session) redirect("/sign-in");
  const { id } = await params;
  const sp = await searchParams;
  const store = await getStore();
  const app = await store.apps.getById(id);
  if (!app || app.ownerGithubId !== session.githubUserId) redirect("/dashboard");

  // Publishable-app result page.
  if (sp.type === "publishable" && sp.pk) {
    return (
      <AuthedShell githubLogin={session.githubLogin} breadcrumb={app.name}>
        <PublishableCreatedPage app={app} pkPlain={sp.pk} />
      </AuthedShell>
    );
  }

  const key = await readOneTimeKey();
  const isCli = sp.cli === "1";

  if (!key) {
    return (
      <AuthedShell githubLogin={session.githubLogin} breadcrumb={app.name}>
        <h1>Secret already displayed</h1>
        <p>
          The <code>AUTH_AI_SECRET</code> was shown once and the relay only
          stores a SHA-256 hash — we can't recover it for you later. If you
          didn't copy it (or the CLI didn't receive it), revoke this app and
          create a new one.
        </p>
        <p style={{ marginTop: 24, display: "flex", gap: 12 }}>
          <Link href={`/apps/${id}`} className="au-btn">
            Manage app
          </Link>
          <Link href="/dashboard" className="au-btn au-btn-secondary">
            Back to dashboard
          </Link>
        </p>
      </AuthedShell>
    );
  }

  // CLI flow: a POST form auto-submits to http://127.0.0.1:PORT/callback
  // with the secret in the body. Browsers don't store POST bodies in
  // history, so the secret never appears in any URL. The state nonce is
  // in the URL (it's a public CSRF identifier, not a secret).
  if (isCli && sp.port && sp.state) {
    const callback = `http://127.0.0.1:${encodeURIComponent(sp.port)}/callback`;
    return (
      <AuthedShell githubLogin={session.githubLogin} breadcrumb={app.name}>
        <h1>App created — returning to your terminal</h1>
        <p>
          Sending the secret to your local CLI listener. If nothing happens
          within a few seconds, click the button below to send it manually.
        </p>
        <form id="cb" method="POST" action={callback} style={{ marginTop: 12 }}>
          <input type="hidden" name="key" value={key} />
          <input type="hidden" name="state" value={sp.state} />
          <input type="hidden" name="app_id" value={id} />
          <button className="au-btn" type="submit">
            Send secret to terminal
          </button>
        </form>
        <AutoSubmit formId="cb" />
        <div className="au-callout" style={{ marginTop: 32 }}>
          If your terminal session was lost, copy this into your{" "}
          <code>.env</code> manually. <strong>Treat it like a password</strong>{" "}
          — never commit it or share it.
        </div>
        <pre className="au-code">AUTH_AI_SECRET={key}</pre>
      </AuthedShell>
    );
  }

  const showTemplate = sp.template === "supabase";
  const supabaseTemplate = showTemplate ? renderSupabaseEdgeTemplate({
    appName: app.name,
    secretEnvVar: "AUTH_AI_SECRET",
    relayUrl: process.env.AUTHAI_RELAY_URL ?? "https://relay.authai.io",
    allowedOrigin: app.origin,
  }) : null;

  return (
    <AuthedShell githubLogin={session.githubLogin} breadcrumb={app.name}>
      <h1>App created</h1>

      <h2>Your AuthAI secret</h2>
      <p>
        Shown once. The relay stores only a hash — we can't recover this for
        you later. Treat it like a password: keep it server-side, never commit
        it to git, never paste it in a chat.
      </p>
      <pre className="au-code">AUTH_AI_SECRET={key}</pre>

      {supabaseTemplate && (
        <section style={{ marginTop: "2rem" }}>
          <h2>Supabase Edge Function template</h2>
          <p>Save as <code>supabase/functions/chat/index.ts</code>:</p>
          <pre style={{ background: "#f5f5f5", padding: "1rem", overflow: "auto", maxHeight: "20rem" }}>{supabaseTemplate}</pre>
          <CopySnippetButton snippet={supabaseTemplate} />
          <p style={{ color: "#666", marginTop: "0.5rem" }}>
            Then: <code>supabase secrets set AUTH_AI_SECRET=&lt;the-key-above&gt;</code><br />
            And: <code>supabase functions deploy chat --project-ref &lt;your-project&gt;</code>
          </p>
        </section>
      )}

      <h2>Next steps</h2>
      <ol style={{ paddingLeft: 20, color: "var(--text-body)", fontSize: 14, lineHeight: 1.8 }}>
        <li>
          Install the SDK: <code>npm install @authai/react</code>
        </li>
        <li>
          Wrap your app with{" "}
          <code>&lt;AuthAIProvider relayUrl="https://relay.authai.io"&gt;</code>
        </li>
        <li>
          Drop in <code>&lt;SignInWithChatGPT /&gt;</code>
        </li>
      </ol>

      <p style={{ marginTop: 32, display: "flex", gap: 12 }}>
        <Link href="/dashboard" className="au-btn">
          Back to dashboard
        </Link>
        <Link href={`/apps/${id}`} className="au-btn au-btn-secondary">
          Manage app
        </Link>
      </p>
    </AuthedShell>
  );
}

// ---------------------------------------------------------------------------
// Publishable-app result
// ---------------------------------------------------------------------------

function PublishableCreatedPage({
  app,
  pkPlain,
}: {
  app: AppRow;
  pkPlain: string;
}) {
  const snippet = `configureAuthAI({
  relayUrl: "https://relay.authai.io",
  appName: ${JSON.stringify(app.name)},
  appId: ${JSON.stringify(pkPlain)},
});`;

  return (
    <>
      <h1>App created</h1>
      <p>Add this to your project:</p>
      <pre className="au-code">{snippet}</pre>
      <CopySnippetButton snippet={snippet} />

      <p style={{ marginTop: "1rem", fontSize: 14, color: "var(--text-body)" }}>
        <strong>Origin:</strong> {app.origin}
        <br />
        This key only works from that origin. Save it now — once you close this
        tab, the only way to get a new one is to rotate from your dashboard. You
        can add more origins later from{" "}
        <Link href={`/apps/${app.id}`}>your app settings</Link>.
      </p>

      <p style={{ marginTop: 32, display: "flex", gap: 12 }}>
        <Link href="/dashboard" className="au-btn">
          Back to dashboard
        </Link>
        <Link href={`/apps/${app.id}`} className="au-btn au-btn-secondary">
          Manage app
        </Link>
      </p>
    </>
  );
}
