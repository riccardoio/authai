import { createHash } from "node:crypto";
// The `openai` peer is optional. We import it as a TYPE only — runtime
// resolution happens via a dynamic import inside tryAttachOpenAI() so users
// without the package don't see a missing-module error at SDK load time.
// `import type` is erased at compile time and never produces a require/import
// call in the emitted JS.
import type OpenAI from "openai";

export type ProviderId = "openai" | "xai" | "github";

export type AuthAIUser = {
  id: string;
  provider: ProviderId;
};

export type AuthAISession = {
  user: AuthAIUser;
  session: { expires: number | null };
  apiKey: string;
  baseURL: string;
  /**
   * A pre-configured `openai` SDK instance. Only present when the `openai`
   * peer dependency is installed; otherwise `undefined`. Always null-check
   * before using if you support backends without `openai` installed.
   */
  openai?: OpenAI;
};

export type CacheEntry = {
  value: { user: AuthAIUser; session: { expires: number | null } };
  expiresAt: number;
};

export type CacheAdapter = {
  get(key: string): CacheEntry | undefined | Promise<CacheEntry | undefined>;
  set(key: string, entry: CacheEntry): void | Promise<void>;
  delete(key: string): void | Promise<void>;
};

export type SessionOptions = {
  /** The session JWT issued by the AuthAI relay (forwarded from the client). */
  jwt: string | null | undefined;
  /** Relay base URL, e.g. https://relay.authai.io. No trailing slash needed. */
  relayUrl: string;
  /**
   * Builder-app secret (`authai_v1_…`) identifying which tenant the call
   * belongs to. Required when talking to a multi-tenant relay (AuthAI Cloud)
   * — the relay's tenant middleware uses it to look up the app row before
   * any token decryption happens. Self-hosted single-tenant relays can omit
   * this. When set, it's sent as `x-authai-secret` on `/auth/whoami` AND
   * pinned as a default header on the constructed `openai` client.
   */
  secret?: string;
  /**
   * Cache identity responses for ~60s (default true). Identity caching is
   * non-authoritative — every model call still goes through the relay, where
   * revocation is enforced. Set to false to disable, or pass a custom adapter
   * for serverless / cross-instance setups.
   */
  cache?: boolean | CacheAdapter;
  /** Override the in-process cache TTL (default 60s, capped by JWT exp). */
  cacheTtlMs?: number;
  /** Replace the global fetch implementation (e.g. for tests). */
  fetch?: typeof fetch;
};

export class AuthAIUnauthorized extends Error {
  readonly status: number;
  constructor(message = "unauthorized") {
    super(message);
    this.name = "AuthAIUnauthorized";
    this.status = 401;
  }
}

const DEFAULT_TTL_MS = 60_000;
const inProcessCache = new Map<string, CacheEntry>();
const defaultCache: CacheAdapter = {
  get: (k) => inProcessCache.get(k),
  set: (k, e) => {
    inProcessCache.set(k, e);
  },
  delete: (k) => {
    inProcessCache.delete(k);
  },
};

function trimRelay(url: string): string {
  return url.replace(/\/+$/, "");
}

function jwtCacheKey(jwt: string): string {
  return createHash("sha256").update(jwt).digest("hex");
}

async function tryAttachOpenAI(
  result: AuthAISession,
  secret: string | undefined,
): Promise<void> {
  try {
    const mod = await import("openai").catch(() => null);
    if (!mod) return;
    // Resolve the OpenAI constructor across CommonJS interop edge cases.
    // Type assertion (instead of `any`) keeps the dynamic dispatch contained
    // to a few lines while still giving consumers the typed result.openai
    // they declared in AuthAISession.
    const ctor =
      (mod as { default?: typeof OpenAI }).default ??
      (mod as { OpenAI?: typeof OpenAI }).OpenAI ??
      (mod as unknown as typeof OpenAI);
    if (typeof ctor !== "function") return;
    const defaultHeaders = secret ? { "x-authai-secret": secret } : undefined;
    result.openai = new ctor({
      apiKey: result.apiKey,
      baseURL: result.baseURL,
      defaultHeaders,
    });
  } catch {
    /* openai not installed; that's fine */
  }
}

async function fetchWhoami(opts: {
  jwt: string;
  relayUrl: string;
  secret: string | undefined;
  fetchImpl: typeof fetch;
}): Promise<{ user: AuthAIUser; session: { expires: number | null } }> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${opts.jwt}`,
  };
  if (opts.secret) headers["x-authai-secret"] = opts.secret;
  const res = await opts.fetchImpl(`${trimRelay(opts.relayUrl)}/auth/whoami`, {
    method: "GET",
    headers,
  });
  if (!res.ok) throw new AuthAIUnauthorized();
  const json = (await res.json().catch(() => null)) as any;
  const id = json?.user?.id;
  const provider = json?.user?.provider;
  if (typeof id !== "string" || typeof provider !== "string") {
    throw new AuthAIUnauthorized();
  }
  if (provider !== "openai" && provider !== "xai" && provider !== "github") {
    throw new AuthAIUnauthorized();
  }
  const expires =
    typeof json?.session?.expires === "number" ? json.session.expires : null;
  return { user: { id, provider }, session: { expires } };
}

async function resolveSession(opts: SessionOptions): Promise<AuthAISession> {
  if (typeof opts.jwt !== "string" || opts.jwt.length === 0) {
    throw new AuthAIUnauthorized("missing jwt");
  }
  const fetchImpl = opts.fetch ?? globalThis.fetch;
  if (typeof fetchImpl !== "function") {
    throw new Error("@authai/server requires a global fetch (Node >= 18)");
  }
  const cacheEnabled = opts.cache !== false;
  const cache: CacheAdapter | null = cacheEnabled
    ? opts.cache && opts.cache !== true
      ? opts.cache
      : defaultCache
    : null;
  const ttlMs = Math.max(0, opts.cacheTtlMs ?? DEFAULT_TTL_MS);
  const cacheKey = jwtCacheKey(opts.jwt);
  const now = Date.now();

  let identity: { user: AuthAIUser; session: { expires: number | null } } | null = null;
  if (cache) {
    const hit = await cache.get(cacheKey);
    if (hit && hit.expiresAt > now) identity = hit.value;
  }
  if (!identity) {
    identity = await fetchWhoami({
      jwt: opts.jwt,
      relayUrl: opts.relayUrl,
      secret: opts.secret,
      fetchImpl,
    });
    if (cache && ttlMs > 0) {
      const jwtExpMs =
        identity.session.expires !== null ? identity.session.expires * 1000 : Infinity;
      const cappedExpiry = Math.min(now + ttlMs, jwtExpMs);
      if (cappedExpiry > now) {
        await cache.set(cacheKey, { value: identity, expiresAt: cappedExpiry });
      }
    }
  }

  const baseURL = `${trimRelay(opts.relayUrl)}/v1`;
  const result: AuthAISession = {
    user: identity.user,
    session: identity.session,
    apiKey: opts.jwt,
    baseURL,
  };
  await tryAttachOpenAI(result, opts.secret);
  return result;
}

export const authai = {
  /**
   * Verify a session JWT with the relay and resolve the calling user.
   *
   * Returns `{ user, session, apiKey, baseURL, openai? }`. `apiKey` and
   * `baseURL` let you build any AI client (LangChain, AI SDK, openai SDK,
   * custom fetch). `openai` is a pre-configured `openai` SDK instance,
   * present only when the `openai` package is installed as a peer.
   *
   * Throws `AuthAIUnauthorized` on missing/invalid/revoked JWTs.
   */
  session(opts: SessionOptions): Promise<AuthAISession> {
    return resolveSession(opts);
  },
  /** Manually evict a JWT from the in-process identity cache. */
  uncache(jwt: string): void {
    if (typeof jwt !== "string" || jwt.length === 0) return;
    inProcessCache.delete(jwtCacheKey(jwt));
  },
};
