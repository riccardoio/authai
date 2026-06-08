"use client";

import {
  createContext, useCallback, useContext, useEffect, useMemo, useRef, useState,
  useSyncExternalStore,
} from "react";
import { createRoot } from "react-dom/client";
import { decodeJwtProvider, isJwtCurrentlyValid, revokeSession, signInWithProvider, type ProviderId } from "./auth.js";
import { resolveStorage, type TokenStorage } from "./storage.js";
import { AuthAIDialog, type DialogStep } from "./dialog/Dialog.js";
import type { AuthAITheme } from "./dialog/theme.js";
import {
  getSingletonSnapshot,
  subscribeSingleton,
  signInSingleton,
  signOutSingleton,
  cancelSingletonFlow,
} from "./singleton.js";
import { SingletonDialogHost } from "./singleton-dialog-host.js";

export type AuthAIContextValue = {
  relayUrl: string | null;
  jwt: string | null;
  provider: ProviderId | null;
  isSignedIn: boolean;
  error: string | null;
  signIn: (provider?: ProviderId) => void;
  signOut: () => void;
};

const Ctx = createContext<AuthAIContextValue | null>(null);

type Phase = "idle" | "explain" | "picker" | "fetching" | "code" | "success" | "error";

export type AuthAIProviderProps = {
  relayUrl: string;
  appName: string;
  /**
   * SSR hand-off. When set, the provider initializes isSignedIn from this
   * jwt synchronously (no flash of unauth). On the client, storage takes
   * over after first render.
   */
  initialJwt?: string | null;
  theme?: AuthAITheme;
  storage?: "localStorage" | "memory" | "cookie" | TokenStorage;
  children: React.ReactNode;
};

export function AuthAIProvider({
  relayUrl, appName, initialJwt, theme, storage, children,
}: AuthAIProviderProps) {
  const adapter = useMemo(() => resolveStorage(storage), [storage]);
  const [jwt, setJwt] = useState<string | null>(() => {
    // If caller explicitly passed initialJwt (even null), honor that. But
    // reject non-null values that are obviously stale (expired / malformed)
    // so a stale cookie can't put the UI into a broken signed-in shell.
    if (initialJwt !== undefined) {
      if (initialJwt === null) return null;
      return isJwtCurrentlyValid(initialJwt) ? initialJwt : null;
    }
    const stored = adapter.get();
    return stored && isJwtCurrentlyValid(stored) ? stored : null;
  });
  const [phase, setPhase] = useState<Phase>("idle");
  const [originStep, setOriginStep] = useState<DialogStep>("explain");
  const [presetProvider, setPresetProvider] = useState<ProviderId | null>(null);
  const [pickedProvider, setPickedProvider] = useState<ProviderId | null>(null);
  const [code, setCode] = useState<{ userCode: string; verificationUrl: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [toastVisible, setToastVisible] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showToast = useCallback(() => {
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    setToastVisible(true);
    toastTimerRef.current = setTimeout(() => setToastVisible(false), 1600);
  }, []);

  const copyCode = useCallback((value: string) => {
    try {
      if (typeof navigator !== "undefined" && navigator.clipboard) {
        navigator.clipboard.writeText(value).catch(() => {});
      }
    } catch { /* ignore */ }
  }, []);

  const openVerification = useCallback((url: string) => {
    if (typeof window === "undefined") return;
    window.open(url, "_blank", "noopener,noreferrer");
  }, []);

  const reset = useCallback(() => {
    setPhase("idle");
    setOriginStep("explain");
    setPresetProvider(null);
    setPickedProvider(null);
    setCode(null);
    setError(null);
    setToastVisible(false);
    if (toastTimerRef.current) {
      clearTimeout(toastTimerRef.current);
      toastTimerRef.current = null;
    }
  }, []);

  const startFlow = useCallback(async (providerId: ProviderId) => {
    if (!appName) throw new Error("AuthAIProvider requires an `appName` prop");
    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    setError(null);
    setCode(null);
    setPickedProvider(providerId);
    setPhase("fetching");
    try {
      const fresh = await signInWithProvider({
        relayUrl,
        provider: providerId,
        signal: ctrl.signal,
        onVerification: ({ verificationUrl, userCode }) => {
          setCode({ userCode, verificationUrl });
          copyCode(userCode);
          showToast();
          setPhase((c) => (c === "fetching" ? "code" : c));
          setOriginStep("code");
        },
      });
      adapter.set(fresh);
      setJwt(fresh);
      setPhase("success");
      setTimeout(() => reset(), 250);
    } catch (err) {
      if ((err as Error).name === "AbortError") return;
      setError((err as Error).message);
      setPhase("error");
    }
  }, [appName, relayUrl, adapter, copyCode, showToast, reset]);

  const signIn = useCallback((provider?: ProviderId) => {
    if (!appName) throw new Error("AuthAIProvider requires an `appName` prop before signIn");
    setError(null);
    setCode(null);
    setPickedProvider(null);
    if (provider) {
      setPresetProvider(provider);
    } else {
      setPresetProvider(null);
    }
    setPhase("explain");
  }, [appName]);

  const handleExplainContinue = useCallback(() => {
    if (presetProvider) {
      setOriginStep("explain");
      startFlow(presetProvider);
    } else {
      setPhase("picker");
    }
  }, [presetProvider, startFlow]);

  const handlePickProvider = useCallback((id: ProviderId) => {
    setOriginStep("picker");
    startFlow(id);
  }, [startFlow]);

  const handleOpenProvider = useCallback(() => {
    if (!code) return;
    openVerification(code.verificationUrl);
  }, [code, openVerification]);

  const handleManualCopy = useCallback(() => {
    if (!code) return;
    copyCode(code.userCode);
    showToast();
  }, [code, copyCode, showToast]);

  const signOut = useCallback(() => {
    abortRef.current?.abort();
    if (jwt) revokeSession(relayUrl, jwt).catch(() => {});
    adapter.clear();
    setJwt(null);
    reset();
  }, [adapter, jwt, relayUrl, reset]);

  const cancel = useCallback(() => {
    abortRef.current?.abort();
    reset();
  }, [reset]);

  const handleTryDifferentProvider = useCallback(() => {
    abortRef.current?.abort();
    setError(null);
    setCode(null);
    setPickedProvider(null);
    setPresetProvider(null);
    setOriginStep("picker");
    setPhase("picker");
  }, []);

  useEffect(() => () => {
    abortRef.current?.abort();
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
  }, []);

  const dialogOpen =
    phase === "explain" || phase === "picker" || phase === "fetching" ||
    phase === "code" || phase === "error";
  const dialogStep: DialogStep =
    phase === "error" ? "error" :
    phase === "picker" ? "picker" :
    phase === "code" ? "code" :
    phase === "fetching" ? originStep :
    "explain";

  const value: AuthAIContextValue = {
    relayUrl,
    jwt,
    provider: jwt ? decodeJwtProvider(jwt) : null,
    isSignedIn: jwt !== null,
    error,
    signIn,
    signOut,
  };

  return (
    <Ctx.Provider value={value}>
      {children}
      <AuthAIDialog
        open={dialogOpen}
        step={dialogStep}
        appName={appName}
        presetProvider={presetProvider}
        pickedProvider={pickedProvider}
        userCode={code?.userCode ?? null}
        verificationUrl={code?.verificationUrl ?? null}
        error={error}
        theme={theme}
        toastVisible={toastVisible}
        onContinueExplain={handleExplainContinue}
        onPickProvider={handlePickProvider}
        onOpenProvider={handleOpenProvider}
        onCopy={handleManualCopy}
        onCancel={cancel}
        onTryDifferentProvider={handleTryDifferentProvider}
      />
    </Ctx.Provider>
  );
}

function ensureSingletonDialogMounted(): void {
  if (typeof document === "undefined") return;
  if (document.querySelector("[data-authai-singleton-dialog]")) return;
  const host = document.createElement("div");
  host.setAttribute("data-authai-singleton-dialog", "");
  document.body.appendChild(host);
  createRoot(host).render(<SingletonDialogHost />);
}

function useSingletonContextValue(): AuthAIContextValue {
  useEffect(() => { ensureSingletonDialogMounted(); }, []);
  const snap = useSyncExternalStore(
    subscribeSingleton,
    getSingletonSnapshot,
    getSingletonSnapshot, // server snapshot — same SSR-safe initial value
  );
  return useMemo<AuthAIContextValue>(() => ({
    relayUrl: snap.relayUrl,
    jwt: snap.jwt,
    provider: snap.provider,
    isSignedIn: snap.isSignedIn,
    error: snap.error,
    signIn: (p) => { void signInSingleton(p); },
    signOut: () => signOutSingleton(),
  }), [snap]);
}

/**
 * Read the current AuthAI session.
 *
 * Resolution order:
 *   1. Nearest <AuthAIProvider> context — used if present.
 *   2. Module-level singleton — populated by configureAuthAI().
 *
 * Always returns a value; never throws. `relayUrl` is null when no provider
 * is mounted AND configureAuthAI() has not been called.
 */
export function useAuthAI(): AuthAIContextValue {
  const ctx = useContext(Ctx);
  const singleton = useSingletonContextValue();
  return ctx ?? singleton;
}

export { SingletonDialogHost } from "./singleton-dialog-host.js";
export { cancelSingletonFlow };
