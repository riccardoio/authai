/**
 * `authai-cloud init` — option B activation flow.
 *
 * Steps:
 *   1. Bind 127.0.0.1 on a random port.
 *   2. Open https://cloud.authai.dev/cli-init?port=PORT&state=STATE in the
 *      user's browser. The webapp handles GitHub OAuth + app creation.
 *   3. The "App created" page submits an HTML form POST to
 *      http://127.0.0.1:PORT/callback with `key`, `state`, `app_id` in
 *      the body. POST bodies don't enter browser history, server access
 *      logs, or screenshot-shareable URLs — the API key never appears in
 *      a URL anywhere.
 *   4. Listener accepts the POST, validates state, writes AUTH_AI_SECRET
 *      to .env, prints SDK install instructions.
 *
 * Mismatching `state` values are ignored without closing the listener:
 * any other local process making opportunistic POSTs to the bound port
 * can't DoS the setup flow that way. Only a matching state or the
 * 5-minute timeout closes the listener.
 *
 * No GitHub OAuth code in the CLI. No /admin endpoints on the relay.
 * Just localhost ↔ browser ↔ webapp.
 */

import { promises as fs } from "node:fs";
import { createServer, type Server, type IncomingMessage, type ServerResponse } from "node:http";
import { randomBytes } from "node:crypto";
import { spawn } from "node:child_process";
import { platform } from "node:os";

export type InitOptions = {
  webappUrl?: string;
  relayUrl?: string;
  envFile?: string;
  force?: boolean;
};

const DEFAULT_WEBAPP = "https://cloud.authai.dev";
const DEFAULT_RELAY = "https://relay.authai.dev";
const DEFAULT_ENV_FILE = ".env";

export async function runInit(opts: InitOptions): Promise<void> {
  const webappUrl = (opts.webappUrl ?? DEFAULT_WEBAPP).replace(/\/$/, "");
  const relayUrl = (opts.relayUrl ?? DEFAULT_RELAY).replace(/\/$/, "");
  const envFile = opts.envFile ?? DEFAULT_ENV_FILE;

  console.log(`\nAuthAI Cloud setup\n`);
  console.log(`Webapp:  ${webappUrl}`);
  console.log(`Relay:   ${relayUrl}`);
  console.log(`Env:     ${envFile}\n`);

  // Pre-flight: refuse to overwrite an existing AUTH_AI_SECRET (unless --force).
  if (await fileExists(envFile)) {
    const current = await fs.readFile(envFile, "utf8");
    if (/^AUTH_AI_SECRET=/m.test(current) && !opts.force) {
      throw new Error(
        `${envFile} already has AUTH_AI_SECRET — refusing to overwrite. Use --force to replace.`,
      );
    }
  }

  const state = randomBytes(16).toString("hex");
  const result = await waitForBrowserCallback(state, (port) => {
    const target = new URL(`${webappUrl}/cli-init`);
    target.searchParams.set("port", String(port));
    target.searchParams.set("state", state);
    console.log(`\n1/2 Opening your browser to sign in...`);
    console.log(`     ${target.toString()}\n`);
    openInBrowser(target.toString()).catch(() => {
      // Browser auto-open is best-effort. The URL is also printed above so
      // the user can paste it manually.
    });
  });

  console.log(`✓ Received API key from webapp\n`);

  console.log(`2/2 Writing AUTH_AI_SECRET to ${envFile}...`);
  await writeEnvKey(envFile, result.key, opts.force ?? false);
  console.log(`✓ ${envFile} updated\n`);

  console.log(`──────────────────────────────────────────────────────────`);
  console.log(`Done. Your app can now use Sign-in-with-ChatGPT.\n`);
  console.log(`Next steps:`);
  console.log(`  1. Install the SDK:`);
  console.log(`       npm install @authai/react`);
  console.log(`  2. Wrap your app:`);
  console.log(`       <AuthAIProvider relayUrl="${relayUrl}">`);
  console.log(`         <YourApp />`);
  console.log(`       </AuthAIProvider>`);
  console.log(`  3. Add the sign-in button:`);
  console.log(`       <SignInWithChatGPT />`);
  console.log(``);
  if (result.appId) {
    console.log(`Manage limits and view audit log at:`);
    console.log(`  ${webappUrl}/apps/${result.appId}`);
    console.log(``);
  }
}

// ---------------------------------------------------------------------------
// Browser callback listener
// ---------------------------------------------------------------------------

type CallbackResult = {
  key: string;
  appId?: string;
};

/**
 * Body size cap. The legitimate payload is three short strings
 * (key ≈ 50 bytes, state ≈ 32 bytes, app_id ≈ 32 bytes). 8KB is
 * generous and bounds any pathological request a local process could
 * send to chew memory.
 */
const MAX_BODY_BYTES = 8 * 1024;

async function readBody(req: IncomingMessage): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const chunks: Buffer[] = [];
    let total = 0;
    req.on("data", (chunk: Buffer) => {
      total += chunk.length;
      if (total > MAX_BODY_BYTES) {
        req.destroy();
        reject(new Error("body too large"));
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

function parseBody(
  contentType: string,
  raw: string,
): Record<string, string> {
  // application/x-www-form-urlencoded (default form POST) OR application/json
  if (contentType.startsWith("application/json")) {
    try {
      const parsed = JSON.parse(raw);
      return typeof parsed === "object" && parsed !== null ? parsed : {};
    } catch {
      return {};
    }
  }
  const out: Record<string, string> = {};
  for (const [k, v] of new URLSearchParams(raw)) out[k] = v;
  return out;
}

async function waitForBrowserCallback(
  expectedState: string,
  onPortBound: (port: number) => void,
): Promise<CallbackResult> {
  return new Promise<CallbackResult>((resolve, reject) => {
    let server: Server;
    let settled = false;
    const finish = (action: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      // setImmediate so the response flushes before the socket dies.
      setImmediate(() => {
        try { server.close(); } catch { /* noop */ }
        action();
      });
    };

    const timeoutMs = 5 * 60 * 1000; // 5 min
    const timeout = setTimeout(() => {
      finish(() => reject(new Error("timed out waiting for browser callback")));
    }, timeoutMs);

    server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
      try {
        if (!req.url) {
          res.writeHead(400).end("missing url");
          return;
        }
        const url = new URL(req.url, "http://127.0.0.1");

        // GET /callback used to carry the key in the query string. We no
        // longer accept that — the webapp posts the key in a form body.
        if (req.method === "GET" && url.pathname === "/callback") {
          res.writeHead(405).end("use POST");
          return;
        }
        if (req.method !== "POST" || url.pathname !== "/callback") {
          res.writeHead(404).end("not found");
          return;
        }

        const raw = await readBody(req);
        const body = parseBody(req.headers["content-type"] ?? "", raw);

        const state = body.state ?? "";
        const key = body.key ?? "";
        const appId = body.app_id ?? undefined;

        // State mismatch: a local process or an old form is hitting us
        // with the wrong nonce. Refuse this attempt but DON'T close the
        // listener — the legitimate callback is still in flight and we
        // don't want anyone to DoS our setup flow by racing in. The
        // 5-minute timeout is the real upper bound.
        if (state !== expectedState) {
          res.writeHead(400).end("state mismatch");
          return;
        }

        if (!key) {
          res.writeHead(400).end("missing key");
          return;
        }

        res.writeHead(200, { "Content-Type": "text/html" });
        res.end(
          `<!doctype html><html><body style="font-family:system-ui;padding:48px;text-align:center">` +
            `<h2>You can close this tab.</h2>` +
            `<p>Return to your terminal — the CLI has your key.</p>` +
            `</body></html>`,
        );

        finish(() => resolve({ key, appId }));
      } catch (err) {
        // Body parse / oversize errors get a 400 but don't terminate the
        // listener — same reasoning as state mismatch.
        try { res.writeHead(400).end("bad request"); } catch { /* noop */ }
      }
    });

    server.on("error", (err) => {
      finish(() => reject(err));
    });

    // Bind ephemeral port (port=0) on 127.0.0.1 ONLY — never 0.0.0.0,
    // which would leak the listener to the local network.
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      if (!addr || typeof addr === "string") {
        finish(() => reject(new Error("could not bind local port")));
        return;
      }
      onPortBound(addr.port);
    });
  });
}

// ---------------------------------------------------------------------------
// Open URL in default browser
// ---------------------------------------------------------------------------

async function openInBrowser(url: string): Promise<void> {
  const os = platform();
  let cmd: string;
  let args: string[];
  if (os === "darwin") {
    cmd = "open";
    args = [url];
  } else if (os === "win32") {
    cmd = "cmd";
    args = ["/c", "start", "", url];
  } else {
    cmd = "xdg-open";
    args = [url];
  }
  return new Promise<void>((resolve, reject) => {
    const child = spawn(cmd, args, { detached: true, stdio: "ignore" });
    child.unref();
    child.on("error", reject);
    // Best-effort — once the browser is spawned we're done.
    setImmediate(resolve);
  });
}

// ---------------------------------------------------------------------------
// Env file write
// ---------------------------------------------------------------------------

async function writeEnvKey(path: string, key: string, force: boolean): Promise<void> {
  let current = "";
  if (await fileExists(path)) {
    current = await fs.readFile(path, "utf8");
  }
  const line = `AUTH_AI_SECRET=${key}`;
  if (/^AUTH_AI_SECRET=/m.test(current)) {
    if (!force) {
      throw new Error(
        `${path} already has AUTH_AI_SECRET — refusing to overwrite. Use --force to replace.`,
      );
    }
    const replaced = current.replace(/^AUTH_AI_SECRET=.*$/m, line);
    await fs.writeFile(path, replaced);
    return;
  }
  const sep = current.length === 0 || current.endsWith("\n") ? "" : "\n";
  await fs.writeFile(path, `${current}${sep}${line}\n`);
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await fs.access(path);
    return true;
  } catch {
    return false;
  }
}
