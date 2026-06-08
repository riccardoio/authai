"use client";

import { useState, useTransition } from "react";
import type { OriginRow } from "@authai/relay-store-postgres";
import {
  addOriginAction,
  disableOriginAction,
  enableOriginAction,
  removeOriginAction,
} from "./origins-actions";

type CsrfTokens = {
  add: string;
  disable: string;
  enable: string;
  remove: string;
};

export function OriginsSection({
  appId,
  origins,
  csrfTokens,
}: {
  appId: string;
  origins: OriginRow[];
  csrfTokens: CsrfTokens;
}) {
  const [showAdd, setShowAdd] = useState(false);
  const [error, setError] = useState<string | null>(null);

  return (
    <section style={{ marginTop: "2rem" }}>
      <h2>Origins ({origins.length})</h2>
      <p style={{ color: "#666" }}>
        The publishable key only works from these origins. Add your preview +
        production URLs.
      </p>

      <ul style={{ listStyle: "none", padding: 0 }}>
        {origins.map((o) => (
          <OriginRowItem
            key={o.id}
            appId={appId}
            origin={o}
            onError={setError}
            csrfDisable={csrfTokens.disable}
            csrfEnable={csrfTokens.enable}
            csrfRemove={csrfTokens.remove}
          />
        ))}
      </ul>

      {!showAdd ? (
        <button onClick={() => setShowAdd(true)}>+ Add origin</button>
      ) : (
        <AddOriginForm
          appId={appId}
          csrfAdd={csrfTokens.add}
          onClose={() => setShowAdd(false)}
          onError={setError}
        />
      )}
      {error && (
        <p style={{ color: "crimson", marginTop: "1rem" }}>{error}</p>
      )}
    </section>
  );
}

function OriginRowItem({
  appId,
  origin,
  onError,
  csrfDisable,
  csrfEnable,
  csrfRemove,
}: {
  appId: string;
  origin: OriginRow;
  onError: (msg: string | null) => void;
  csrfDisable: string;
  csrfEnable: string;
  csrfRemove: string;
}) {
  const [pending, startTransition] = useTransition();
  return (
    <li
      style={{
        padding: "0.5rem 0",
        borderBottom: "1px solid #eee",
        display: "flex",
        gap: "0.5rem",
        alignItems: "center",
      }}
    >
      <span style={{ flex: 1 }}>
        {origin.status === "active" ? "✓" : "⊘"}{" "}
        <code>{origin.origin}</code>
        <span
          style={{
            marginLeft: "0.5rem",
            padding: "0.125rem 0.5rem",
            background: "#f0f0f0",
            borderRadius: 4,
            fontSize: "0.75rem",
          }}
        >
          {origin.tier}
        </span>
        {origin.lastUsedAt && (
          <span
            style={{ marginLeft: "0.5rem", fontSize: "0.75rem", color: "#666" }}
          >
            · used {new Date(origin.lastUsedAt).toLocaleString()}
            {origin.lastUsedIp ? ` from ${origin.lastUsedIp}` : ""}
          </span>
        )}
      </span>
      {origin.status === "active" ? (
        <button
          disabled={pending}
          onClick={() =>
            startTransition(async () => {
              onError(null);
              const r = await disableOriginAction(appId, origin.id, csrfDisable);
              if (r.error) onError(r.error);
              else location.reload();
            })
          }
        >
          Disable
        </button>
      ) : (
        <button
          disabled={pending}
          onClick={() =>
            startTransition(async () => {
              onError(null);
              const r = await enableOriginAction(appId, origin.id, csrfEnable);
              if (r.error) onError(r.error);
              else location.reload();
            })
          }
        >
          Enable
        </button>
      )}
      <RemoveOriginButton appId={appId} origin={origin} onError={onError} csrfRemove={csrfRemove} />
    </li>
  );
}

function RemoveOriginButton({
  appId,
  origin,
  onError,
  csrfRemove,
}: {
  appId: string;
  origin: OriginRow;
  onError: (msg: string | null) => void;
  csrfRemove: string;
}) {
  const [confirming, setConfirming] = useState(false);
  const [typed, setTyped] = useState("");
  const [pending, startTransition] = useTransition();
  const hostname = (() => {
    try {
      return new URL(origin.origin).hostname;
    } catch {
      return "";
    }
  })();

  if (!confirming) {
    return <button onClick={() => setConfirming(true)}>Remove</button>;
  }
  return (
    <span
      style={{ display: "flex", gap: "0.25rem", alignItems: "center" }}
    >
      <input
        type="text"
        placeholder={`type ${hostname}`}
        value={typed}
        onChange={(e) => setTyped(e.target.value)}
        autoFocus
        style={{ padding: "0.25rem" }}
      />
      <button
        disabled={typed !== hostname || pending}
        onClick={() =>
          startTransition(async () => {
            onError(null);
            const r = await removeOriginAction(appId, origin.id, csrfRemove);
            if (r.error) onError(r.error);
            else location.reload();
          })
        }
      >
        {pending ? "Removing…" : "Confirm remove"}
      </button>
      <button
        onClick={() => {
          setConfirming(false);
          setTyped("");
        }}
      >
        Cancel
      </button>
    </span>
  );
}

function AddOriginForm({
  appId,
  csrfAdd,
  onClose,
  onError,
}: {
  appId: string;
  csrfAdd: string;
  onClose: () => void;
  onError: (msg: string | null) => void;
}) {
  const [origin, setOrigin] = useState("");
  const [typed, setTyped] = useState("");
  const [pending, startTransition] = useTransition();
  const hostname = (() => {
    try {
      return new URL(origin).hostname;
    } catch {
      return "";
    }
  })();
  const canSubmit = typed === hostname && hostname.length > 0 && !pending;

  return (
    <div style={{ padding: "1rem", background: "#f8f8f8", marginTop: "1rem" }}>
      <label>
        New origin URL
        <input
          type="url"
          value={origin}
          onChange={(e) => {
            setOrigin(e.target.value);
            setTyped("");
          }}
          style={{ width: "100%", padding: "0.5rem", marginTop: "0.5rem" }}
          required
          autoFocus
        />
      </label>
      {hostname && (
        <div style={{ marginTop: "0.5rem" }}>
          <label>
            Type the hostname to confirm: <code>{hostname}</code>
            <input
              type="text"
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              style={{
                width: "100%",
                padding: "0.5rem",
                marginTop: "0.5rem",
              }}
              autoComplete="off"
              spellCheck={false}
            />
          </label>
        </div>
      )}
      <div style={{ marginTop: "1rem", display: "flex", gap: "0.5rem" }}>
        <button
          disabled={!canSubmit}
          onClick={() =>
            startTransition(async () => {
              onError(null);
              const r = await addOriginAction(appId, origin, csrfAdd);
              if (r.error) onError(r.error);
              else location.reload();
            })
          }
        >
          {pending ? "Adding…" : "Add"}
        </button>
        <button onClick={onClose}>Cancel</button>
      </div>
    </div>
  );
}
