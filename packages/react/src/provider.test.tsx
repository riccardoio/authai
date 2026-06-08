import { describe, expect, it, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { AuthAIProvider, useAuthAI } from "./provider.js";
import { configureAuthAI } from "./configure.js";
import { resetSingletonForTests } from "./singleton.js";
import { SignIn } from "./button.js";

function Probe() {
  const auth = useAuthAI();
  return (
    <div>
      <span data-testid="relay">{auth.relayUrl ?? "none"}</span>
      <span data-testid="signed">{auth.isSignedIn ? "yes" : "no"}</span>
    </div>
  );
}

describe("useAuthAI", () => {
  beforeEach(() => resetSingletonForTests());

  it("reads from singleton when no provider is mounted", () => {
    configureAuthAI({ relayUrl: "https://singleton.example", appName: "S" });
    render(<Probe />);
    expect(screen.getByTestId("relay").textContent).toBe("https://singleton.example");
  });

  it("reads from provider context when mounted, ignoring singleton", () => {
    configureAuthAI({ relayUrl: "https://singleton.example", appName: "S" });
    render(
      <AuthAIProvider relayUrl="https://provider.example" appName="P">
        <Probe />
      </AuthAIProvider>
    );
    expect(screen.getByTestId("relay").textContent).toBe("https://provider.example");
  });

  it("does NOT throw when called with no provider and no config", () => {
    expect(() => render(<Probe />)).not.toThrow();
    expect(screen.getByTestId("relay").textContent).toBe("none");
    expect(screen.getByTestId("signed").textContent).toBe("no");
  });
});

describe("AuthAIProvider initialJwt", () => {
  beforeEach(() => resetSingletonForTests());

  it("hydrates isSignedIn from initialJwt at first render", () => {
    // Construct a syntactically-valid JWT with payload {"prov":"xai"}.
    // Header and signature are stubs — provider only inspects payload.prov.
    const header = btoa(JSON.stringify({ alg: "HS256" })).replace(/=+$/, "");
    const payload = btoa(JSON.stringify({ prov: "xai" })).replace(/=+$/, "");
    const fakeJwt = `${header}.${payload}.sig`;
    render(
      <AuthAIProvider relayUrl="https://r" appName="P" initialJwt={fakeJwt}>
        <Probe />
      </AuthAIProvider>
    );
    expect(screen.getByTestId("signed").textContent).toBe("yes");
  });

  it("treats initialJwt=null as signed out", () => {
    render(
      <AuthAIProvider relayUrl="https://r" appName="P" initialJwt={null}>
        <Probe />
      </AuthAIProvider>
    );
    expect(screen.getByTestId("signed").textContent).toBe("no");
  });

  it("explicit initialJwt={null} suppresses the localStorage read (SSR hand-off)", () => {
    // Pre-load localStorage as if a previous session existed.
    // Use the same key the localStorageAdapter writes to.
    window.localStorage.setItem("authai:jwt", "stale.jwt.from.previous.session");
    try {
      render(
        <AuthAIProvider relayUrl="https://r" appName="P" initialJwt={null}>
          <Probe />
        </AuthAIProvider>
      );
      // Without the fix, isSignedIn would be "yes" because adapter.get() ran.
      // With the fix, initialJwt={null} wins.
      expect(screen.getByTestId("signed").textContent).toBe("no");
    } finally {
      window.localStorage.removeItem("authai:jwt");
    }
  });

  it("treats initialJwt omitted (undefined) as signed out unless storage has a jwt", () => {
    // Memory storage is empty by default — no jwt found.
    render(
      <AuthAIProvider relayUrl="https://r" appName="P" storage="memory">
        <Probe />
      </AuthAIProvider>
    );
    expect(screen.getByTestId("signed").textContent).toBe("no");
  });
});

describe("SingletonDialogHost auto-mount", () => {
  beforeEach(() => {
    resetSingletonForTests();
    // Remove any host divs left over from previous tests (the DOM-presence
    // guard prevents re-mount across tests, so we explicitly clean up).
    document.querySelectorAll("[data-authai-singleton-dialog]").forEach(n => n.remove());
  });

  it("attaches exactly one host div on first useAuthAI() mount", () => {
    configureAuthAI({ relayUrl: "https://r", appName: "T" });
    render(<Probe />);
    const hosts = document.querySelectorAll("[data-authai-singleton-dialog]");
    expect(hosts.length).toBe(1);
  });

  it("does not append a second host on subsequent renders", () => {
    configureAuthAI({ relayUrl: "https://r", appName: "T" });
    const { unmount } = render(<Probe />);
    unmount();
    render(<Probe />);
    const hosts = document.querySelectorAll("[data-authai-singleton-dialog]");
    expect(hosts.length).toBe(1);
  });
});

describe("SingletonDialogHost SSR guard", () => {
  // Note: we cannot fully simulate SSR in jsdom because React itself relies
  // on document for rendering. We verify the host's import doesn't blow up
  // and that its module-level state is sane.
  it("import does not throw", async () => {
    const mod = await import("./singleton-dialog-host.js");
    expect(typeof mod.SingletonDialogHost).toBe("function");
  });
});

describe("<SignIn> with singleton", () => {
  beforeEach(() => {
    resetSingletonForTests();
    document.querySelectorAll("[data-authai-singleton-dialog]").forEach(n => n.remove());
  });

  it("renders without a provider", () => {
    configureAuthAI({ relayUrl: "https://r", appName: "P" });
    render(<SignIn provider="openai">Sign in</SignIn>);
    expect(screen.getByText("Sign in")).toBeInTheDocument();
  });

  it("renders without a provider AND without configureAuthAI being called", () => {
    // Even with no config, the button must render — clicking it would
    // surface an error state via the singleton, not throw at render time.
    render(<SignIn>Sign in</SignIn>);
    expect(screen.getByText("Sign in")).toBeInTheDocument();
  });
});
