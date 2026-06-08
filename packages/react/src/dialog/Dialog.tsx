"use client";

import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import type { ProviderId } from "../auth.js";
import { Step1 } from "./Step1.js";
import { Step2 } from "./Step2.js";
import { StepError } from "./StepError.js";
import { StepPicker } from "./StepPicker.js";
import { ensureStylesInjected } from "./styles.js";
import { resolveTheme, themeToCssVars, type AuthAITheme } from "./theme.js";

export type DialogStep = "explain" | "picker" | "code" | "error";

export type AuthAIDialogProps = {
  open: boolean;
  step: DialogStep;
  appName: string;
  presetProvider: ProviderId | null;
  pickedProvider: ProviderId | null;
  userCode: string | null;
  verificationUrl: string | null;
  error: string | null;
  theme?: AuthAITheme;
  onContinueExplain: () => void;
  onPickProvider: (id: ProviderId) => void;
  onOpenProvider: () => void;
  onCopy: () => void;
  toastVisible: boolean;
  onCancel: () => void;
  onTryDifferentProvider: () => void;
};

const CLOSE_ANIM_MS = 200;

export function AuthAIDialog(props: AuthAIDialogProps) {
  const {
    open, step, appName, presetProvider, pickedProvider,
    userCode, verificationUrl, error, theme,
    onContinueExplain, onPickProvider, onOpenProvider, onCopy, toastVisible, onCancel,
    onTryDifferentProvider,
  } = props;

  const [mounted, setMounted] = useState(open);
  const [displayStep, setDisplayStep] = useState<DialogStep>(step);
  const [systemDark, setSystemDark] = useState<boolean>(() =>
    typeof window !== "undefined" &&
    window.matchMedia("(prefers-color-scheme: dark)").matches,
  );
  const closingTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    ensureStylesInjected();
  }, []);

  useEffect(() => {
    if (open) setDisplayStep(step);
  }, [open, step]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const handler = (e: MediaQueryListEvent) => setSystemDark(e.matches);
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, []);

  useEffect(() => {
    if (open) {
      if (closingTimer.current) {
        clearTimeout(closingTimer.current);
        closingTimer.current = null;
      }
      setMounted(true);
    } else if (mounted) {
      closingTimer.current = setTimeout(() => {
        setMounted(false);
        closingTimer.current = null;
      }, CLOSE_ANIM_MS);
      return () => {
        if (closingTimer.current) clearTimeout(closingTimer.current);
      };
    }
  }, [open, mounted]);

  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCancel();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [open, onCancel]);

  const cssVars = useMemo(() => themeToCssVars(resolveTheme(theme, systemDark)), [theme, systemDark]);

  if (!mounted || typeof document === "undefined") return null;

  const provider = pickedProvider ?? presetProvider ?? "openai";

  return createPortal(
    <div
      className="authai-overlay"
      data-state={open ? "open" : "closed"}
      style={cssVars as CSSProperties}
      onClick={onCancel}
      role="dialog"
      aria-modal="true"
    >
      <div className="authai-card" onClick={(e) => e.stopPropagation()}>
        {displayStep === "explain" && (
          <Step1
            appName={appName}
            presetProvider={presetProvider}
            ready={true}
            error={error}
            onContinue={onContinueExplain}
            onCancel={onCancel}
          />
        )}
        {displayStep === "picker" && (
          <StepPicker appName={appName} onPick={onPickProvider} onCancel={onCancel} />
        )}
        {displayStep === "code" && (
          <Step2
            provider={provider}
            userCode={userCode ?? ""}
            verificationUrl={verificationUrl ?? ""}
            error={null}
            toastVisible={toastVisible}
            onCopy={onCopy}
            onOpenProvider={onOpenProvider}
            onCancel={onCancel}
          />
        )}
        {displayStep === "error" && (
          <StepError
            provider={pickedProvider ?? presetProvider}
            presetProvider={presetProvider}
            message={error ?? "Something went wrong."}
            onTryDifferentProvider={onTryDifferentProvider}
            onCancel={onCancel}
          />
        )}
      </div>
    </div>,
    document.body,
  );
}
