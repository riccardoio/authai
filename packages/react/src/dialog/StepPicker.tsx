import type { ProviderId } from "../auth.js";
import { DialogFooter } from "./Footer.js";
import { ChevronRightIcon } from "./icons.js";
import { PROVIDER_META, PROVIDER_ORDER } from "./providers.js";

export type StepPickerProps = {
  appName: string;
  onPick: (id: ProviderId) => void;
  onCancel: () => void;
};

export function StepPicker({ appName: _appName, onPick, onCancel }: StepPickerProps) {
  return (
    <div className="authai-step">
      <h2 className="authai-title">Choose your AI provider</h2>
      <p className="authai-muted" style={{ textAlign: "center" }}>
        Sign in with the subscription you already pay for.
      </p>
      <div className="authai-provider-list">
        {PROVIDER_ORDER.map((id) => {
          const meta = PROVIDER_META[id];
          return (
            <button
              key={id}
              type="button"
              className="authai-provider-card"
              onClick={() => meta.available && onPick(id)}
              disabled={!meta.available}
              aria-disabled={!meta.available}
            >
              <span className="authai-provider-logo"><meta.Logo /></span>
              <span className="authai-provider-text">
                <span className="authai-provider-name">{meta.displayName}</span>
                <span className="authai-provider-subtitle">
                  {meta.available ? meta.subtitle : "Coming soon"}
                </span>
              </span>
              <span className="authai-provider-chevron"><ChevronRightIcon /></span>
            </button>
          );
        })}
      </div>
      <button type="button" className="authai-button-secondary" onClick={onCancel}>
        Cancel
      </button>
      <DialogFooter />
    </div>
  );
}
