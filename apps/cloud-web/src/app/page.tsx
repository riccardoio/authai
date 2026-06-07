import Link from "next/link";

export default function HomePage() {
  return (
    <main>
      <h1>AuthAI Cloud</h1>
      <p className="muted">
        Sign in with ChatGPT (and Copilot, and xAI) for your app — your users
        pay for AI through their own subscription, you don't pay per token.
      </p>

      <h2>Set up in 30 seconds</h2>
      <pre><code>npx authai-cloud init</code></pre>
      <p>
        Opens this site to sign in with GitHub, prompts for an app name and
        origin, then writes <code>AUTH_AI_SECRET</code> to your <code>.env</code>.
      </p>

      <p>
        Or do it manually:{" "}
        <Link href="/sign-in">sign in with GitHub</Link>, create an app, copy
        the key into your project.
      </p>

      <h2>How it works</h2>
      <p>
        Your end user signs in once with their ChatGPT (or Copilot, or xAI)
        subscription. Your app calls models on their behalf via the standard
        <code> openai</code> SDK, pointed at the relay. The cost stays on their
        plan.
      </p>

      <h2>What's stored where</h2>
      <p>
        The relay encrypts every user's OAuth tokens with a fresh AES-256 key
        per record. That key is embedded in the user's session JWT — it's
        never persisted server-side. Even an operator with full database
        access can't decrypt stored tokens without the user's JWT.
      </p>
      <p>
        The same code is open-source and self-hostable. If you don't want a
        cloud dependency, run it yourself.{" "}
        <a href="https://github.com/riccardoio/authai">
          github.com/riccardoio/authai
        </a>
      </p>

      <h2>Docs</h2>
      <ul>
        <li>
          <Link href="/docs">How AuthAI works under the hood</Link>
        </li>
        <li>
          <a href="https://github.com/riccardoio/authai/blob/main/README.md">
            README on GitHub
          </a>
        </li>
        <li>
          <a href="https://github.com/riccardoio/authai/blob/main/docs/security.md">
            Security model
          </a>
        </li>
      </ul>

      <hr />
      <p className="muted">
        Experimental. Free, rate-limited. Not affiliated with OpenAI. AuthAI
        Cloud relies on the public Codex CLI OAuth client to authenticate
        with ChatGPT's backend, so model availability tracks the Codex catalog.
      </p>

      <footer>
        <a href="https://github.com/riccardoio/authai">source</a>
        &nbsp;·&nbsp; <Link href="/sign-in">sign in</Link>
        &nbsp;·&nbsp; <Link href="/docs">docs</Link>
      </footer>
    </main>
  );
}
