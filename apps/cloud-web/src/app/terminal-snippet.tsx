"use client";

import { useState } from "react";

/**
 * Single-line terminal snippet with a copy-to-clipboard button.
 * Visual cue is the standard "$ command" shell prompt; the leading
 * `$` is presentational only and never copied. Matches the dark
 * #1a1a1a fill of the CodePreview window to one-glance-read as
 * "terminal/shell", not as a pill or a chip.
 */
export function TerminalSnippet({ command }: { command: string }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(command);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      /* clipboard unavailable (insecure context, old browser); silent. */
    }
  }

  return (
    <div className="landing-terminal" role="group" aria-label="Terminal command">
      <span className="landing-terminal-prompt" aria-hidden="true">$</span>
      <code className="landing-terminal-cmd">{command}</code>
      <button
        type="button"
        className="landing-terminal-copy"
        onClick={copy}
        aria-label={copied ? "Copied" : "Copy command"}
        data-copied={copied || undefined}
      >
        {copied ? <CheckIcon /> : <CopyIcon />}
      </button>
      <span
        className="landing-terminal-toast"
        role="status"
        aria-live="polite"
        data-visible={copied || undefined}
      >
        Copied
      </span>
    </div>
  );
}

function CopyIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <polyline points="20 6 9 17 4 12" />
    </svg>
  );
}
