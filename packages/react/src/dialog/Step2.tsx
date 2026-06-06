import type { ProviderId } from "../auth.js";
import { CheckIcon, CopyIcon, ExternalLinkIcon } from "./icons.js";
import { PROVIDER_META } from "./providers.js";

export type Step2Props = {
  provider: ProviderId;
  userCode: string;
  verificationUrl: string;
  error: string | null;
  toastVisible: boolean;
  onCopy: () => void;
  onOpenProvider: () => void;
  onCancel: () => void;
};

export function Step2({
  provider,
  userCode,
  error,
  toastVisible,
  onCopy,
  onOpenProvider,
  onCancel,
}: Step2Props) {
  const providerName = PROVIDER_META[provider]?.displayName ?? "your provider";

  return (
    <div className="authai-step">
      <h2 className="authai-title">Approve on {providerName}</h2>

      <div className="authai-code-row">
        <div className="authai-code-block" aria-label="Authorization code">{userCode}</div>
        <button
          type="button"
          className="authai-copy-button"
          onClick={onCopy}
          aria-label="Copy code"
          title="Copy code"
        >
          <CopyIcon />
        </button>
      </div>
      <p className="authai-code-label">Your authorization code</p>

      <p className="authai-muted">
        Paste this code on {providerName} to finish — it's already in your clipboard.
      </p>

      {!error && (
        <button type="button" className="authai-button-primary" onClick={onOpenProvider}>
          Continue
          <ExternalLinkIcon />
        </button>
      )}

      {!error && (
        <div className="authai-status">
          <div className="authai-spinner" />
          <span>Waiting for you to authorize…</span>
        </div>
      )}

      {error && <p className="authai-error">{error}</p>}

      <button type="button" className="authai-button-secondary" onClick={onCancel}>
        Cancel
      </button>

      {toastVisible && (
        <div className="authai-toast" role="status">
          <CheckIcon />
          Code copied
        </div>
      )}
    </div>
  );
}
