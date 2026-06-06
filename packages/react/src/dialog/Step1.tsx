import type { ProviderId } from "../auth.js";
import { LockIcon } from "./icons.js";
import { PROVIDER_META } from "./providers.js";

export type Step1Props = {
  appName: string;
  presetProvider: ProviderId | null;
  ready: boolean;
  error: string | null;
  onContinue: () => void;
  onCancel: () => void;
};

export function Step1({
  appName,
  presetProvider,
  ready,
  error,
  onContinue,
  onCancel,
}: Step1Props) {
  const providerName = presetProvider ? PROVIDER_META[presetProvider].displayName : null;
  const title = providerName
    ? <>Connect {providerName} to <span className="authai-strong">{appName}</span></>
    : <>Connect an AI subscription to <span className="authai-strong">{appName}</span></>;
  const body = providerName
    ? `Sign in once. ${appName} will use your ${providerName} subscription to run AI features — billed to your existing plan, never to a card you give ${appName}.`
    : `Sign in once. ${appName} will use your subscription to run AI features — billed to your existing plan, never to a card you give ${appName}.`;
  const continueLabel = ready ? (presetProvider ? "Continue" : "Choose provider") : "Preparing…";

  return (
    <div className="authai-step">
      <div className="authai-icon-badge"><LockIcon /></div>
      <h2 className="authai-title">{title}</h2>
      <p className="authai-body">{body}</p>
      <p className="authai-muted">
        {appName} never sees your password. You can revoke access anytime in your provider's settings.
      </p>

      <button
        type="button"
        className="authai-button-primary"
        onClick={onContinue}
        disabled={!ready}
      >
        {continueLabel}
      </button>

      {error && <p className="authai-error">{error}</p>}

      <button type="button" className="authai-button-secondary" onClick={onCancel}>
        Cancel
      </button>
    </div>
  );
}
