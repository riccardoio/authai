import { useAuthAI } from "./provider.js";

export type SignInWithChatGPTProps = {
  children?: React.ReactNode;
  className?: string;
  style?: React.CSSProperties;
};

export function SignInWithChatGPT({ children, className, style }: SignInWithChatGPTProps) {
  const { signIn, status } = useAuthAI();
  const busy = status === "starting" || status === "awaiting-user";
  return (
    <button
      type="button"
      className={className}
      style={style}
      onClick={signIn}
      disabled={busy}
    >
      {busy ? "Signing in…" : children ?? "Sign in with ChatGPT"}
    </button>
  );
}
