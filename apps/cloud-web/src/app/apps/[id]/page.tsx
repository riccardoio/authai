import Link from "next/link";
import { redirect } from "next/navigation";
import { ulid } from "ulid";
import { getSession } from "@/lib/session";
import { getFullStore, getStore } from "@/lib/db";
import { AuthedShell } from "../../authed-shell";
import { OriginsSection } from "./origins-section";

export default async function AppDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await getSession();
  if (!session) redirect("/sign-in");
  const { id } = await params;
  // Legacy flat store: carries apps + audit namespaces used by this page.
  const store = await getStore();
  const app = await store.apps.getById(id);
  if (!app || app.ownerGithubId !== session.githubUserId) redirect("/dashboard");

  async function revoke(_: FormData) {
    "use server";
    const session = await getSession();
    if (!session) redirect("/sign-in");
    const store = await getStore();
    const existing = await store.apps.getById(id);
    if (!existing || existing.ownerGithubId !== session.githubUserId) {
      redirect("/dashboard");
    }
    const now = Date.now();
    if (!existing.revokedAt) {
      await store.apps.revoke(id, now);
      await store.audit.write({
        id: ulid(),
        ts: now,
        actorType: "owner",
        actorId: session.githubUserId,
        appId: id,
        eventType: "app_kill_switched",
        payload: { initiated_by: "owner", reason: "revoke via dashboard" },
      });
    }
    redirect("/dashboard");
  }

  const recentEvents = await store.audit.listByApp(id, 20);
  // Full store provides the origins namespace (not available on the legacy store).
  const fullStore = await getFullStore();
  const origins =
    app.credentialType === "publishable"
      ? await fullStore.origins.listForApp(app.id)
      : [];

  return (
    <AuthedShell githubLogin={session.githubLogin} breadcrumb={app.name}>
      <h1>{app.name}</h1>
      <p className="au-card-meta" style={{ marginTop: -4, marginBottom: 24 }}>
        {app.id}
      </p>

      <h2>Origin</h2>
      <div className="au-card">
        <code style={{ fontFamily: "var(--font-mono)", fontSize: 13 }}>
          {app.origin}
        </code>
        <p className="au-hint" style={{ marginTop: 10 }}>
          The browser must send this exact value in the <code>Origin</code>{" "}
          header on calls to <code>/auth/start</code>. The React SDK sets it
          automatically — you usually don't need to think about this.
        </p>
      </div>

      <h2>Limits</h2>
      <div className="au-card">
        <div className="au-card-row">
          <span>Requests per minute</span>
          <strong>{app.rateLimitPerMin}</strong>
        </div>
        <div className="au-card-row" style={{ marginTop: 8 }}>
          <span>Requests per day</span>
          <strong>{app.dailyRequestCap}</strong>
        </div>
      </div>

      {app.credentialType === "publishable" && (
        <OriginsSection appId={app.id} origins={origins} />
      )}

      <h2>Recent events</h2>
      {recentEvents.length === 0 ? (
        <div className="au-empty">No events yet.</div>
      ) : (
        <div className="au-card" style={{ paddingTop: 4, paddingBottom: 4 }}>
          {recentEvents.map((e) => (
            <div key={e.id} className="au-event-row">
              <span className="au-event-when">
                {new Date(e.ts).toISOString().replace("T", " ").slice(0, 19)}
              </span>
              <span style={{ color: "var(--text-muted)" }}>
                {e.actorType}:{e.actorId.slice(0, 8)}
              </span>
              <span className="au-event-type" style={{ marginLeft: "auto" }}>
                {e.eventType}
              </span>
            </div>
          ))}
        </div>
      )}

      <div className="au-danger-zone">
        <h2>Danger zone</h2>
        <p>
          Revoke this app. All existing user JWTs return 401 immediately, and
          new sign-ins are blocked. The audit log row is preserved.
        </p>
        <form action={revoke}>
          <button className="au-btn au-btn-danger" type="submit">
            Revoke app
          </button>
        </form>
      </div>
    </AuthedShell>
  );
}
