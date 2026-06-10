"use client";

import { useSyncExternalStore, useMemo, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { AuthAIDialog, type DialogStep } from "./dialog/Dialog.js";
import {
  getSingletonSnapshot,
  subscribeSingleton,
  signInSingleton,
  cancelSingletonFlow,
  confirmSingletonExplain,
  pickSingletonProvider,
} from "./singleton.js";
import type { ProviderId } from "./auth.js";

/**
 * Renders the singleton's sign-in dialog into document.body via portal.
 * Apps using configureAuthAI() do not need to mount this explicitly — the
 * hook's first signIn() call auto-mounts it.
 */
export function SingletonDialogHost() {
  const snap = useSyncExternalStore(subscribeSingleton, getSingletonSnapshot, getSingletonSnapshot);
  const [container, setContainer] = useState<HTMLElement | null>(null);

  useEffect(() => {
    if (typeof document === "undefined") return;
    setContainer(document.body);
  }, []);

  const open = snap.phase !== "idle";
  const step: DialogStep = useMemo(() => {
    if (snap.phase === "error") return "error";
    if (snap.phase === "picker") return "picker";
    if (snap.phase === "code") return "code";
    if (snap.phase === "fetching") return snap.originStep ?? "picker";
    return "explain";
  }, [snap.phase, snap.originStep]);

  if (!container) return null;

  return createPortal(
    <AuthAIDialog
      open={open}
      step={step}
      appName={snap.appName ?? "this app"}
      presetProvider={snap.pendingProvider}
      pickedProvider={snap.pendingProvider}
      userCode={snap.verification?.userCode ?? null}
      verificationUrl={snap.verification?.verificationUrl ?? null}
      error={snap.error}
      theme={snap.theme ?? undefined}
      toastVisible={false}
      onContinueExplain={() => {
        if (snap.pendingProvider) {
          void confirmSingletonExplain();
        } else {
          void signInSingleton();
        }
      }}
      onPickProvider={(id: ProviderId) => { void pickSingletonProvider(id); }}
      onOpenProvider={() => {
        if (snap.verification && typeof window !== "undefined") {
          window.open(snap.verification.verificationUrl, "_blank", "noopener,noreferrer");
        }
      }}
      onCopy={() => {
        if (snap.verification && typeof navigator !== "undefined" && navigator.clipboard) {
          navigator.clipboard.writeText(snap.verification.userCode).catch(() => {});
        }
      }}
      onCancel={cancelSingletonFlow}
      onTryDifferentProvider={() => { void signInSingleton(); }}
    />,
    container,
  );
}
