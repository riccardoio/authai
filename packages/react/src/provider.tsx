import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { revokeSession, signInWithChatGPT } from "./auth.js";
import { resolveStorage, type TokenStorage } from "./storage.js";

export type AuthStatus = "signed-out" | "starting" | "awaiting-user" | "signed-in" | "error";

export type AuthAIContextValue = {
  relayUrl: string;
  jwt: string | null;
  isSignedIn: boolean;
  status: AuthStatus;
  verificationUrl: string | null;
  userCode: string | null;
  error: string | null;
  signIn: () => Promise<void>;
  signOut: () => void;
};

const Ctx = createContext<AuthAIContextValue | null>(null);

export type AuthAIProviderProps = {
  relayUrl: string;
  storage?: "localStorage" | "memory" | TokenStorage;
  children: React.ReactNode;
};

export function AuthAIProvider({ relayUrl, storage, children }: AuthAIProviderProps) {
  const adapter = useMemo(() => resolveStorage(storage), [storage]);
  const [jwt, setJwt] = useState<string | null>(() => adapter.get());
  const [status, setStatus] = useState<AuthStatus>(() => (adapter.get() ? "signed-in" : "signed-out"));
  const [verificationUrl, setVerificationUrl] = useState<string | null>(null);
  const [userCode, setUserCode] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const signIn = useCallback(async () => {
    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    setError(null);
    setVerificationUrl(null);
    setUserCode(null);
    setStatus("starting");
    try {
      const fresh = await signInWithChatGPT({
        relayUrl,
        signal: ctrl.signal,
        onVerification: ({ verificationUrl, userCode }) => {
          setVerificationUrl(verificationUrl);
          setUserCode(userCode);
          setStatus("awaiting-user");
        },
      });
      adapter.set(fresh);
      setJwt(fresh);
      setStatus("signed-in");
      setVerificationUrl(null);
      setUserCode(null);
    } catch (err) {
      if ((err as Error).name === "AbortError") return;
      setError((err as Error).message);
      setStatus("error");
    }
  }, [relayUrl, adapter]);

  const signOut = useCallback(() => {
    abortRef.current?.abort();
    if (jwt) revokeSession(relayUrl, jwt).catch(() => { /* best-effort */ });
    adapter.clear();
    setJwt(null);
    setStatus("signed-out");
    setVerificationUrl(null);
    setUserCode(null);
    setError(null);
  }, [adapter, jwt, relayUrl]);

  useEffect(() => () => abortRef.current?.abort(), []);

  const value: AuthAIContextValue = {
    relayUrl,
    jwt,
    isSignedIn: jwt !== null,
    status,
    verificationUrl,
    userCode,
    error,
    signIn,
    signOut,
  };

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAuthAI(): AuthAIContextValue {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useAuthAI must be used inside <AuthAIProvider>");
  return ctx;
}
