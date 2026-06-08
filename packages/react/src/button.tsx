"use client";

import type { ProviderId } from "./auth.js";
import { useAuthAI } from "./provider.js";

export type SignInProps = {
  provider?: ProviderId;
  children?: React.ReactNode;
  className?: string;
  style?: React.CSSProperties;
};

export function SignIn({ provider, children, className, style }: SignInProps) {
  const { signIn, isSignedIn } = useAuthAI();
  if (isSignedIn) return null;
  return (
    <button
      type="button"
      className={className}
      style={style}
      onClick={() => signIn(provider)}
    >
      {children ?? "Sign in"}
    </button>
  );
}

/**
 * @deprecated Use `<SignIn provider="openai">` instead. Kept for v2 backward compat.
 */
export function SignInWithChatGPT(props: Omit<SignInProps, "provider">) {
  return <SignIn {...props} provider="openai">{props.children ?? "Sign in with ChatGPT"}</SignIn>;
}
