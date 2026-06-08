"use client";

import { useState, useTransition } from "react";
import type { PublishableKeyRow } from "@authai/relay-store-postgres";
import { rotateKeyAction, revokeKeyAction } from "./keys-actions";

export function KeysSection({
  appId,
  keys,
  csrfTokens,
}: {
  appId: string;
  keys: PublishableKeyRow[];
  csrfTokens: { rotate: string; revoke: string };
}) {
  const active = keys.filter((k) => k.status === "active");
  const [pending, startTransition] = useTransition();
  const [newKey, setNewKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  return (
    <section style={{ marginTop: "2rem" }}>
      <h2>Publishable keys ({active.length} of 3 active)</h2>

      <ul style={{ listStyle: "none", padding: 0 }}>
        {keys.map((k) => (
          <li
            key={k.id}
            style={{
              padding: "0.5rem 0",
              borderBottom: "1px solid #eee",
              display: "flex",
              gap: "0.5rem",
              alignItems: "center",
            }}
          >
            <span style={{ flex: 1 }}>
              <strong>[{k.status}]</strong>{" "}
              <code>authai_pk_…{k.keyHash.slice(0, 8)}</code>
              {k.label && (
                <span style={{ marginLeft: "0.5rem" }}>· {k.label}</span>
              )}
              <span
                style={{
                  marginLeft: "0.5rem",
                  color: "#666",
                  fontSize: "0.75rem",
                }}
              >
                created {new Date(k.createdAt).toLocaleDateString()}
                {" · "}
                {k.lastUsedAt
                  ? `last used ${new Date(k.lastUsedAt).toLocaleString()}${k.lastUsedIp ? " from " + k.lastUsedIp : ""}`
                  : "never used"}
              </span>
            </span>
            {k.status === "active" && (
              <button
                disabled={pending}
                onClick={() => {
                  if (
                    !confirm(
                      "Revoke this key? Requests using it will return 401 immediately.",
                    )
                  )
                    return;
                  startTransition(async () => {
                    setError(null);
                    const r = await revokeKeyAction(
                      appId,
                      k.id,
                      csrfTokens.revoke,
                    );
                    if (r.error) setError(r.error);
                    else location.reload();
                  });
                }}
              >
                Revoke
              </button>
            )}
          </li>
        ))}
      </ul>

      {newKey ? (
        <div
          style={{ padding: "1rem", background: "#e8f5e9", marginTop: "1rem" }}
        >
          <p>
            <strong>New key created — save it now (shown ONCE):</strong>
          </p>
          <pre
            style={{ background: "#f5f5f5", padding: "1rem", overflow: "auto" }}
          >
            {newKey}
          </pre>
          <button onClick={() => navigator.clipboard.writeText(newKey)}>
            Copy
          </button>
          <p style={{ color: "#666", marginTop: "0.5rem" }}>
            Update the <code>appId</code> in your code, deploy, then revoke the
            old key from the list above once it shows no recent traffic.
          </p>
        </div>
      ) : (
        active.length < 3 && (
          <button
            disabled={pending}
            onClick={() =>
              startTransition(async () => {
                setError(null);
                const label = prompt(
                  "Label for the new key (optional):",
                  `rotation-${new Date().toISOString().slice(0, 10)}`,
                );
                if (label === null) return; // user cancelled
                const r = await rotateKeyAction(
                  appId,
                  label || null,
                  csrfTokens.rotate,
                );
                if (r.error) setError(r.error);
                else if (r.plaintext) setNewKey(r.plaintext);
              })
            }
          >
            + Rotate (create new key)
          </button>
        )
      )}
      {error && <p style={{ color: "crimson" }}>{error}</p>}
    </section>
  );
}
