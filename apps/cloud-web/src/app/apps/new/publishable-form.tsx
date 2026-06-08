"use client";

import { useState, useTransition } from "react";
import { createPublishableAppAction } from "./actions";

export function PublishableConfirmForm({
  sessionEmail,
  origin,
  name,
  tier,
  csrfToken,
}: {
  sessionEmail: string;
  origin: string;
  name: string;
  tier: "localhost" | "preview" | "production";
  csrfToken: string;
}) {
  const [editedOrigin, setEditedOrigin] = useState(origin);
  const [editedName, setEditedName] = useState(name);
  const [typed, setTyped] = useState("");
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const hostname = (() => {
    try {
      return new URL(editedOrigin).hostname;
    } catch {
      return "";
    }
  })();

  const canSubmit = typed === hostname && hostname.length > 0 && !pending;

  return (
    <div>
      <h1>Create a publishable AuthAI app</h1>

      <div className="au-callout" style={{ marginTop: "1rem" }}>
        <label className="au-label" htmlFor="pub-origin">Origin</label>
        <input
          className="au-input"
          id="pub-origin"
          type="url"
          value={editedOrigin}
          onChange={(e) => {
            setEditedOrigin(e.target.value);
            setTyped("");
          }}
        />
        <p className="au-hint">
          Tier: <strong>{tier}</strong> · This key will only work from this exact origin.
        </p>
      </div>

      <div style={{ marginTop: "1rem" }}>
        <label className="au-label" htmlFor="pub-name">Name</label>
        <input
          className="au-input"
          id="pub-name"
          type="text"
          value={editedName}
          onChange={(e) => setEditedName(e.target.value)}
          required
        />
      </div>

      <p className="au-hint" style={{ marginTop: "0.75rem" }}>
        Created by: {sessionEmail}
      </p>

      <div className="au-callout" style={{ marginTop: "1rem" }}>
        ⚠️ You are about to create an AuthAI app bound to{" "}
        <code>{hostname || "(invalid origin)"}</code>. After creation, anyone
        who can run JavaScript on that domain will be able to drive your AuthAI
        app's usage. If you did not intend to set up AuthAI for that domain,
        abort now.
      </div>

      {hostname && (
        <div style={{ marginTop: "1rem" }}>
          <label className="au-label" htmlFor="pub-confirm">
            Type the hostname to confirm: <code>{hostname}</code>
          </label>
          <input
            className="au-input"
            id="pub-confirm"
            type="text"
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            autoComplete="off"
            spellCheck={false}
          />
        </div>
      )}

      {error && (
        <p style={{ color: "var(--color-error, crimson)", marginTop: "0.75rem" }}>
          {error}
        </p>
      )}

      <p style={{ marginTop: "1.5rem", display: "flex", gap: 12 }}>
        <button
          className="au-btn"
          type="button"
          disabled={!canSubmit}
          onClick={() => {
            setError(null);
            startTransition(async () => {
              const result = await createPublishableAppAction({
                origin: editedOrigin,
                name: editedName,
                csrf: csrfToken,
              });
              if (result.error) {
                setError(result.error);
              } else if (result.redirect) {
                window.location.href = result.redirect;
              }
            });
          }}
        >
          {pending ? "Creating…" : "Create app"}
        </button>
        <a href="/dashboard" className="au-btn au-btn-secondary">
          Cancel
        </a>
      </p>
    </div>
  );
}
