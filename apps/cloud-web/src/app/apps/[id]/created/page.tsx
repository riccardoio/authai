import Link from "next/link";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { getStore } from "@/lib/db";
import { readOneTimeKey } from "@/lib/one-time-key";
import { AutoSubmit } from "./auto-submit";

/**
 * `/apps/[id]/created` — the one-time post-create page.
 *
 * The API key is NEVER in the URL. It arrived via an HttpOnly cookie set
 * by the Create-App server action; this page consumes (read + delete)
 * the cookie and either renders the key in a code block (web flow) or
 * embeds it as a hidden field in a POST form auto-submitted to the
 * CLI's localhost listener (CLI flow).
 *
 * A refresh after the cookie is consumed shows a "key already
 * displayed" message instead of re-rendering anything — single-use
 * semantics matter because the relay only stores the SHA-256 hash and
 * cannot recover the raw key.
 */
export default async function CreatedPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ cli?: string; port?: string; state?: string }>;
}) {
  const session = await getSession();
  if (!session) redirect("/sign-in");
  const { id } = await params;
  const sp = await searchParams;
  const store = await getStore();
  const app = await store.apps.getById(id);
  if (!app || app.ownerGithubId !== session.githubUserId) redirect("/dashboard");

  const key = await readOneTimeKey();
  const isCli = sp.cli === "1";

  if (!key) {
    return (
      <>
        <nav className="top">
          <div>
            <strong>AuthAI Cloud</strong>
            <span className="muted"> · {app.name}</span>
          </div>
          <div>
            <Link href="/dashboard">dashboard</Link>
          </div>
        </nav>
        <main>
          <h1>Key already displayed</h1>
          <p>
            The API key was shown once and the relay only stores a hash.
            If you didn't copy it (or the CLI didn't receive it), revoke
            this app and create a new one.
          </p>
          <p style={{ marginTop: 24 }}>
            <Link href={`/apps/${id}`} className="btn">
              Manage app
            </Link>
            &nbsp;
            <Link href="/dashboard" className="btn btn-secondary">
              Back to dashboard
            </Link>
          </p>
        </main>
      </>
    );
  }

  // CLI flow: a POST form auto-submits to http://127.0.0.1:PORT/callback
  // with the key in the body. Browsers don't store POST bodies in history,
  // so the key never enters the user's history, Vercel access logs, or
  // anything else URL-based. The state nonce is in the URL (it's a public
  // CSRF identifier, not a secret).
  if (isCli && sp.port && sp.state) {
    const callback = `http://127.0.0.1:${encodeURIComponent(sp.port)}/callback`;
    return (
      <>
        <nav className="top">
          <div>
            <strong>AuthAI Cloud</strong>
            <span className="muted"> · {app.name}</span>
          </div>
          <div>
            <Link href="/dashboard">dashboard</Link>
          </div>
        </nav>
        <main>
          <h1>App created — returning to your terminal</h1>
          <p className="muted">
            Sending the API key to your local CLI listener. If nothing
            happens within a few seconds, click the button below to send
            it manually.
          </p>
          <form
            id="cb"
            method="POST"
            action={callback}
            style={{ marginTop: 12 }}
          >
            <input type="hidden" name="key" value={key} />
            <input type="hidden" name="state" value={sp.state} />
            <input type="hidden" name="app_id" value={id} />
            <button className="btn" type="submit">
              Send key to terminal
            </button>
          </form>
          <AutoSubmit formId="cb" />
          <p className="muted" style={{ marginTop: 24 }}>
            If your terminal session was lost, copy this key into your
            <code> .env </code> manually:
          </p>
          <pre>
            <code>AUTH_AI_KEY={key}</code>
          </pre>
        </main>
      </>
    );
  }

  return (
    <>
      <nav className="top">
        <div>
          <strong>AuthAI Cloud</strong>
          <span className="muted"> · {app.name}</span>
        </div>
        <div>
          <Link href="/dashboard">dashboard</Link>
        </div>
      </nav>
      <main>
        <h1>App created</h1>

        <h2>Your API key</h2>
        <p className="muted">
          Shown once. The relay stores only a hash — we can't recover this
          for you later. Treat it like a password.
        </p>
        <pre>
          <code>AUTH_AI_KEY={key}</code>
        </pre>

        <h2>Next steps</h2>
        <ol>
          <li>
            Install the SDK: <code>npm install @authai/react</code>
          </li>
          <li>
            Wrap your app with <code>&lt;AuthAIProvider relayUrl="https://relay.authai.dev"&gt;</code>
          </li>
          <li>
            Drop in <code>&lt;SignInWithChatGPT /&gt;</code>
          </li>
        </ol>

        <p style={{ marginTop: 32 }}>
          <Link href="/dashboard" className="btn">
            Back to dashboard
          </Link>
        </p>
      </main>
    </>
  );
}
