import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import type { ProviderId } from "@authai-io/react";

type Msg = { role: "user" | "assistant"; content: string };
type ModelEntry = { id: string; owned_by?: string };

type Props = {
  jwt: string;
  provider: ProviderId | null;
  backendUrl: string;
  onSignOut: () => void;
};

const PROVIDER_LABEL: Record<ProviderId, string> = {
  openai: "ChatGPT",
  xai: "Grok",
  github: "GitHub Copilot",
};

export function Chat({ jwt, provider, backendUrl, onSignOut }: Props) {
  const effectiveProvider: ProviderId = provider ?? "openai";
  const [models, setModels] = useState<ModelEntry[]>([]);
  const [model, setModel] = useState<string>("");
  const [modelsErr, setModelsErr] = useState<string | null>(null);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [streaming, setStreaming] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const transcriptRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    let cancelled = false;
    setModels([]);
    setModel("");
    setModelsErr(null);
    (async () => {
      try {
        const res = await fetch(`${backendUrl}/api/models`, {
          headers: { Authorization: `Bearer ${jwt}` },
        });
        if (!res.ok) throw new Error(`${res.status} ${await res.text().catch(() => "")}`);
        const json = (await res.json()) as { data: ModelEntry[] };
        if (cancelled) return;
        setModels(json.data);
        setModel(json.data[0]?.id ?? "");
      } catch (e) {
        if (cancelled) return;
        setModelsErr((e as Error).message);
      }
    })();
    return () => { cancelled = true; };
  }, [jwt, backendUrl]);

  useEffect(() => {
    const el = transcriptRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [messages, streaming]);

  return (
    <>
      <div className="session-bar">
        <span className="session-meta">
          Signed in with <strong>{PROVIDER_LABEL[effectiveProvider]}</strong>
        </span>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <select
            className="model-select"
            value={model}
            onChange={(e) => setModel(e.target.value)}
            disabled={models.length === 0}
          >
            {models.length === 0 && <option value="">Loading…</option>}
            {models.map((m) => (
              <option key={m.id} value={m.id}>{m.id}</option>
            ))}
          </select>
          <button className="btn-ghost" onClick={onSignOut}>Sign out</button>
        </div>
      </div>

      {modelsErr && <p className="inline-error">Models: {modelsErr}</p>}

      <div ref={transcriptRef} className="transcript">
        {messages.length === 0 && !streaming && (
          <p style={{ color: "var(--text-subtle)", margin: 0 }}>
            Ask anything to get started.
          </p>
        )}
        {messages.map((m, i) =>
          m.role === "user" ? (
            <div key={i} className="turn-user">
              <div className="bubble">{m.content || " "}</div>
            </div>
          ) : (
            <div key={i} className="turn-assistant">
              <div className="body">
                {m.content}
                {streaming && i === messages.length - 1 && (
                  m.content.length === 0 ? (
                    <span className="thinking" aria-hidden="true"><span /><span /><span /></span>
                  ) : (
                    <span className="streaming-cursor" aria-hidden="true" />
                  )
                )}
              </div>
            </div>
          ),
        )}
      </div>

      {err && <p className="inline-error">{err}</p>}

      <ReplyInput
        disabled={!model || streaming}
        onSubmit={(text) => streamChat(text)}
      />
    </>
  );

  async function streamChat(text: string) {
    if (!text.trim() || !model || streaming) return;
    setErr(null);
    const next: Msg[] = [...messages, { role: "user", content: text }];
    setMessages([...next, { role: "assistant", content: "" }]);
    setStreaming(true);

    try {
      const res = await fetch(`${backendUrl}/api/chat`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${jwt}`,
        },
        body: JSON.stringify({ model, messages: next }),
      });
      if (!res.ok || !res.body) {
        const body = await res.text().catch(() => "");
        throw new Error(`backend ${res.status}: ${body}`);
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let acc = "";
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        acc += decoder.decode(value, { stream: true });
        setMessages([...next, { role: "assistant", content: acc }]);
      }
    } catch (e) {
      setErr((e as Error).message);
      setMessages(next);
    } finally {
      setStreaming(false);
    }
  }
}

function ReplyInput({
  onSubmit,
  disabled,
  placeholder = "Send a message…",
}: {
  onSubmit: (text: string) => void;
  disabled?: boolean;
  placeholder?: string;
}) {
  const [value, setValue] = useState("");
  const ref = useRef<HTMLTextAreaElement | null>(null);
  const trimmed = value.trim();
  const canSubmit = trimmed.length > 0 && !disabled;

  useEffect(() => { ref.current?.focus(); }, []);

  useEffect(() => {
    const ta = ref.current;
    if (!ta) return;
    ta.style.height = "auto";
    ta.style.height = `${Math.min(ta.scrollHeight, 168)}px`;
  }, [value]);

  function handleKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (disabled) return;
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      submit();
    } else if (e.key === "Escape") {
      e.preventDefault();
      setValue("");
    }
  }

  function submit() {
    if (!canSubmit) return;
    onSubmit(trimmed);
    setValue("");
  }

  return (
    <div className="reply">
      <textarea
        ref={ref}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
        disabled={disabled}
        rows={1}
        aria-label="Your message"
      />
      <button
        type="button"
        className="send-btn"
        onClick={submit}
        disabled={!canSubmit}
        aria-label="Send"
      >
        <svg
          width="18"
          height="18"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.25"
          strokeLinecap="round"
          strokeLinejoin="round"
          style={{ transform: canSubmit ? "rotate(-90deg)" : "rotate(0deg)" }}
        >
          <line x1="12" y1="19" x2="12" y2="5" />
          <polyline points="5 12 12 5 19 12" />
        </svg>
      </button>
    </div>
  );
}
