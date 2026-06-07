import Link from "next/link";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { getStore } from "@/lib/db";

export default async function Dashboard() {
  const session = await getSession();
  if (!session) redirect("/sign-in?return=/dashboard");

  const store = await getStore();
  const apps = await store.apps.listByOwner(session.githubUserId);

  return (
    <>
      <nav className="top">
        <div>
          <strong>AuthAI Cloud</strong>
          <span className="muted"> · dashboard</span>
        </div>
        <div>
          <Link href="/docs">docs</Link>
          <a href="/api/auth/sign-out">sign out (@{session.githubLogin})</a>
        </div>
      </nav>
      <main>
        <h1>Your apps</h1>
        <p className="muted">
          Each app gets a key. The key authorizes your backend to use AuthAI
          Cloud as the relay; end users sign in via the React SDK.
        </p>

        <p>
          <Link href="/apps/new" className="btn">
            Create app
          </Link>
        </p>

        {apps.length === 0 && (
          <div className="card">
            <p className="muted" style={{ margin: 0 }}>
              No apps yet. Create one to get an <code>AUTH_AI_SECRET</code>.
            </p>
          </div>
        )}

        {apps.length > 0 && (
          <table>
            <thead>
              <tr>
                <th>Name</th>
                <th>Origin</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {apps.map((a) => (
                <tr key={a.id}>
                  <td>
                    <Link href={`/apps/${a.id}`}>{a.name}</Link>
                    <div className="muted" style={{ fontSize: 12 }}>{a.id}</div>
                  </td>
                  <td>
                    <code>{a.origin}</code>
                  </td>
                  <td style={{ textAlign: "right" }}>
                    <Link href={`/apps/${a.id}`}>manage</Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </main>
    </>
  );
}
