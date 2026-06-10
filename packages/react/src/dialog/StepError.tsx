import type { ProviderId } from "../auth.js";
import { DialogFooter } from "./Footer.js";
import { ErrorIcon } from "./icons.js";
import { PROVIDER_META } from "./providers.js";

export type StepErrorProps = {
  provider: ProviderId | null;
  message: string;
  presetProvider: ProviderId | null;
  onTryDifferentProvider: () => void;
  onCancel: () => void;
};

export function StepError({
  provider,
  message,
  presetProvider,
  onTryDifferentProvider,
  onCancel,
}: StepErrorProps) {
  const name = provider ? PROVIDER_META[provider].displayName : "your provider";
  const title = `Couldn't connect to ${name}`;
  const cleaned = cleanMessage(message);
  return (
    <div className="authai-step">
      <div className="authai-icon-badge authai-icon-badge-error"><ErrorIcon /></div>
      <h2 className="authai-title">{title}</h2>
      <p className="authai-body" style={{ textAlign: "center" }}>{cleaned}</p>

      {!presetProvider && (
        <button type="button" className="authai-button-primary" onClick={onTryDifferentProvider}>
          Try a different provider
        </button>
      )}

      <button type="button" className="authai-button-secondary" onClick={onCancel}>
        {presetProvider ? "Close" : "Cancel"}
      </button>
      <DialogFooter />
    </div>
  );
}

function cleanMessage(raw: string): string {
  // Strip our own "relay <url>:" or "relay $url:" framing so users see only the
  // upstream message. Also collapse double-prefix patterns like
  // "auth error: ".
  let s = raw
    .replace(/^relay[^:]*:\s*\d+\s*/, "")
    .replace(/^auth error:\s*/, "")
    .trim();
  // If the message still ends in a JSON blob from the upstream, drop it.
  const braceIdx = s.indexOf("{");
  if (braceIdx > 0 && s.lastIndexOf("}") > braceIdx) {
    s = s.slice(0, braceIdx).trim().replace(/[:\s]+$/, "");
  }
  return s.length > 0 ? s : "Something went wrong. Please try again.";
}
