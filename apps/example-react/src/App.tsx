import { AuthAIProvider, useAuthAI, SignInWithChatGPT } from "@authai/react";
import { SignInModal } from "./components/SignInModal.js";
import { Chat } from "./components/Chat.js";

const RELAY_URL = import.meta.env.VITE_RELAY_URL ?? "http://localhost:3000";
const BACKEND_URL = import.meta.env.VITE_BACKEND_URL ?? "http://localhost:4000";

export function App() {
  return (
    <AuthAIProvider relayUrl={RELAY_URL} storage="localStorage">
      <Shell />
    </AuthAIProvider>
  );
}

function Shell() {
  const auth = useAuthAI();

  return (
    <div className="container">
      <h1>AuthAI demo</h1>
      <p className="muted">
        Sign in with your ChatGPT subscription. The example backend at{" "}
        <code>{BACKEND_URL}</code> uses the official <code>openai</code> SDK pointed at the relay.
      </p>

      <div className="card" style={{ marginTop: 24 }}>
        {auth.isSignedIn ? (
          <Chat jwt={auth.jwt!} backendUrl={BACKEND_URL} onSignOut={auth.signOut} />
        ) : (
          <div className="col" style={{ gap: 12 }}>
            <SignInWithChatGPT>Sign in with ChatGPT</SignInWithChatGPT>
            {auth.status === "error" && (
              <p style={{ color: "#b91c1c", margin: 0 }}>{auth.error}</p>
            )}
            <p className="muted" style={{ margin: 0 }}>
              Relay: <code>{RELAY_URL}</code>
            </p>
          </div>
        )}
      </div>

      {auth.status === "awaiting-user" && auth.verificationUrl && auth.userCode && (
        <SignInModal
          verificationUrl={auth.verificationUrl}
          userCode={auth.userCode}
          onCancel={auth.signOut}
        />
      )}
    </div>
  );
}
