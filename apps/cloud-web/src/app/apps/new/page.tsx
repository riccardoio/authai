import Link from "next/link";
import { redirect } from "next/navigation";
import { ulid } from "ulid";
import { getSession } from "@/lib/session";
import { getStore } from "@/lib/db";
import { generateApiKey, hashApiKey, normalizeOrigin, classifyOriginTier } from "@authai/cloud";
import { CLI_BRIDGE_COOKIE, verifyBridge } from "@/lib/cli-bridge";
import { setOneTimeKey } from "@/lib/one-time-key";
import { cookies } from "next/headers";
import { AuthedShell } from "../../authed-shell";
import { PublishableConfirmForm } from "./publishable-form";

export default async function NewAppPage({
  searchParams,
}: {
  searchParams: Promise<{ cli?: string; type?: string; origin?: string; name?: string }>;
}) {
  const session = await getSession();
  if (!session) redirect("/sign-in?return=/apps/new");

  const params = await searchParams;

  // Publishable-app branch — wired by the AI codegen CLI via
  //   /apps/new?type=publishable&origin=https://my-app.com&name=My+App
  if (params.type === "publishable") {
    if (!params.origin) {
      return (
        <AuthedShell githubLogin={session.githubLogin} breadcrumb="New publishable app">
          <h1>Can't create app</h1>
          <p>Missing <code>origin</code> query parameter.</p>
          <p><Link href="/apps/new" className="au-btn au-btn-secondary">Create an app manually instead</Link></p>
        </AuthedShell>
      );
    }
    const presetOrigin = normalizeOrigin(params.origin);
    if (!presetOrigin) {
      return (
        <AuthedShell githubLogin={session.githubLogin} breadcrumb="New publishable app">
          <h1>Can't create app</h1>
          <p>The <code>origin</code> query parameter is not a valid URL.</p>
          <p><Link href="/apps/new" className="au-btn au-btn-secondary">Create an app manually instead</Link></p>
        </AuthedShell>
      );
    }
    const presetName = params.name?.trim() || new URL(presetOrigin).hostname;
    const tier = classifyOriginTier(presetOrigin);
    return (
      <AuthedShell githubLogin={session.githubLogin} breadcrumb="New publishable app">
        <PublishableConfirmForm
          sessionEmail={session.githubEmail ?? session.githubLogin}
          origin={presetOrigin}
          name={presetName}
          tier={tier}
        />
      </AuthedShell>
    );
  }

  const isCliFlow = params.cli === "1";

  async function createApp(formData: FormData) {
    "use server";
    const session = await getSession();
    if (!session) redirect("/sign-in?return=/apps/new");

    const name = String(formData.get("name") ?? "").trim();
    const rawOrigin = String(formData.get("origin") ?? "").trim();
    const cliMode = String(formData.get("cli") ?? "") === "1";
    const includeTemplate = formData.get("includeTemplate") === "supabase";

    if (!name || name.length > 80) {
      throw new Error("name must be 1-80 chars");
    }
    const origin = normalizeOrigin(rawOrigin);
    if (!origin) {
      throw new Error("origin must be a valid http(s) URL");
    }

    const store = await getStore();
    const existing = await store.apps.getByOrigin(origin);
    if (existing) {
      throw new Error("origin already in use by another app");
    }

    const id = `app_${ulid()}`;
    const apiKey = generateApiKey();
    const apiKeyHash = hashApiKey(apiKey);
    const now = Date.now();

    // v1 doesn't enforce DNS verification. Every app is treated as usable
    // regardless of origin. v2 introduces the consent dialog + per-app
    // budgets, at which point originVerified actually gates trust — until
    // then this field is dead weight that's set true so the dashboard
    // doesn't show a "pending DNS" UI that has no path forward.
    try {
      await store.apps.create({
        id,
        apiKeyHash,
        origin,
        name,
        ownerGithubId: session.githubUserId,
        ownerEmail: session.githubEmail,
        originVerified: true,
        originVerifiedAt: now,
        originVerifyToken: "",
        rateLimitPerMin: 60,
        dailyRequestCap: 1000,
      });
    } catch (err) {
      // Raced another tab — the unique index on apps.origin caught it.
      // Surface the same friendly message as the pre-check.
      if (isPostgresUniqueViolation(err)) {
        throw new Error("origin already in use by another app");
      }
      throw err;
    }

    await store.audit.write({
      id: ulid(),
      ts: now,
      actorType: "owner",
      actorId: session.githubUserId,
      appId: id,
      eventType: "app_created",
      payload: {
        owner_github_login: session.githubLogin,
        origin,
        via: cliMode ? "cli" : "web",
      },
    });

    // Pass the API key through an HttpOnly one-time cookie instead of a
    // URL query string. The /created page reads + deletes the cookie,
    // renders either a code block (web flow) or an auto-submitting POST
    // form (CLI flow). Neither path puts the key into browser history,
    // server access logs, or screenshot-shareable URLs.
    await setOneTimeKey(apiKey);

    if (cliMode) {
      const c = await cookies();
      const bridge = await verifyBridge(c.get(CLI_BRIDGE_COOKIE)?.value);
      c.delete(CLI_BRIDGE_COOKIE);
      if (bridge) {
        redirect(
          `/apps/${id}/created?cli=1&port=${bridge.port}&state=${encodeURIComponent(bridge.state)}`,
        );
      }
    }

    redirect(`/apps/${id}/created${includeTemplate ? "?template=supabase" : ""}`);
  }

  return (
    <AuthedShell githubLogin={session.githubLogin} breadcrumb="New app">
      <h1>Create app</h1>
      <p>
        Each app gets a unique <code>AUTH_AI_SECRET</code>. The relay uses it to
        route requests to the right tenant.
      </p>
      {isCliFlow && (
        <div className="au-callout">
          You arrived here from <code>npx authai-cloud init</code>. After you
          submit, we'll <strong>send the new secret back to the CLI</strong>{" "}
          automatically.
        </div>
      )}

      <form action={createApp}>
        {isCliFlow && <input type="hidden" name="cli" value="1" />}

        <label className="au-label" htmlFor="name">App name</label>
        <input
          className="au-input"
          id="name"
          name="name"
          placeholder="My AI App"
          required
          maxLength={80}
        />
        <div className="au-hint">
          Shown on the ChatGPT consent screen when end users sign in.
        </div>

        <label className="au-label" htmlFor="origin">Origin</label>
        <input
          className="au-input"
          id="origin"
          name="origin"
          placeholder="https://myapp.com"
          required
          pattern="https?://.+"
        />
        <div className="au-hint">
          The URL your app runs at — what the browser sends as the{" "}
          <code>Origin</code> header. Use <code>https://myapp.com</code> in
          production, <code>http://localhost:3000</code> for local dev. No
          paths or query strings.
        </div>

        <label style={{ display: "block", marginTop: "1rem" }}>
          <input type="checkbox" name="includeTemplate" value="supabase" />
          {" "}Generate a Supabase Edge Function template (proxies AuthAI from your Supabase project)
        </label>

        <p style={{ marginTop: 32, display: "flex", gap: 12 }}>
          <button className="au-btn" type="submit">
            Create app
          </button>
          <Link href="/dashboard" className="au-btn au-btn-secondary">
            Cancel
          </Link>
        </p>
      </form>
    </AuthedShell>
  );
}

function isPostgresUniqueViolation(err: unknown): boolean {
  // pg surfaces SQLSTATE on the error object as `.code`. 23505 = unique violation.
  return (
    typeof err === "object" &&
    err !== null &&
    "code" in err &&
    (err as { code: string }).code === "23505"
  );
}
