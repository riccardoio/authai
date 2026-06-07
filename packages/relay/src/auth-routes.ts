import { Hono } from "hono";
import { ulid } from "ulid";
import { decryptJson, encryptJson, generateRecordKey, identityId } from "./crypto.js";
import { issueSessionJwt, verifySessionJwt } from "./jwt.js";
import { getProvider, isProviderId } from "./providers/registry.js";
import type { ProviderId } from "./providers/types.js";
import type { DecryptedRecord } from "./refresh.js";
import { createSession, getSession, updateSession } from "./sessions.js";
import type { AuthRecordStore } from "./store.js";

export function createAuthRoutes(deps: {
  store: AuthRecordStore;
  jwtSecret: Uint8Array;
  identitySecret: Buffer;
  originator: string;
}): Hono {
  const app = new Hono();

  app.post("/start", async (c) => {
    let body: any = {};
    try {
      body = await c.req.json();
    } catch {
      /* allow empty body for backward compat */
    }
    const providerId: ProviderId = isProviderId(body?.provider) ? body.provider : "openai";

    try {
      const adapter = getProvider(providerId);
      const device = await adapter.requestDeviceCode(deps.originator);
      const session = createSession({
        providerId,
        deviceAuthId: device.deviceAuthId,
        userCode: device.userCode,
        pollIntervalMs: device.intervalMs,
        expiresInMs: device.expiresInMs,
      });
      return c.json({
        sessionId: session.id,
        provider: providerId,
        userCode: device.userCode,
        verificationUrl: device.verificationUrl,
        expiresInMs: session.expiresAt - Date.now(),
        pollIntervalMs: device.intervalMs,
      });
    } catch (err) {
      return c.json({ error: errorMessage(err) }, 502);
    }
  });

  app.get("/poll/:sessionId", async (c) => {
    const sessionId = c.req.param("sessionId");
    const session = getSession(sessionId);
    if (!session) {
      return c.json({ status: "error", error: "session not found" }, 404);
    }
    if (session.status === "complete" && session.jwt) {
      return c.json({ status: "complete", jwt: session.jwt });
    }
    if (session.status !== "pending") {
      return c.json({ status: session.status, error: session.error });
    }

    try {
      const adapter = getProvider(session.providerId);
      const result = await adapter.pollDeviceCode(
        {
          deviceAuthId: session.deviceAuthId,
          userCode: session.userCode,
        },
        deps.originator,
      );
      if (result.status === "pending") {
        return c.json({ status: "pending" });
      }
      const tokens = result.tokens;
      // Reject any provider response that didn't yield a real, non-empty
      // accountId. Without one we'd compute the same identityId for every
      // user under this provider (HMAC of provider || \0 || "") and the
      // dedup query in `findByAccountHash` would collapse them into a
      // single shared record. Adapters must fail their own lookup loudly.
      if (typeof tokens.accountId !== "string" || tokens.accountId.length === 0) {
        throw new Error(`provider ${session.providerId} did not return an accountId`);
      }
      const accountIdHash = identityId(deps.identitySecret, session.providerId, tokens.accountId);
      const recordKey = generateRecordKey();
      const now = Date.now();
      const refreshLifeMs = 30 * 24 * 60 * 60 * 1000;
      const expiresAt = now + refreshLifeMs;
      const payload = {
        provider: session.providerId,
        access: tokens.access,
        refresh: tokens.refresh,
        expires: tokens.expires,
        accountId: tokens.accountId,
        originator: deps.originator,
      };
      const { iv, blob } = encryptJson(recordKey, payload);

      // Atomic upsert keyed by accountIdHash. Two concurrent polls for the
      // same account will both arrive here, but the DB's UNIQUE constraint
      // ensures only one row exists and both callers receive the same id.
      const resolved = await deps.store.upsertByAccountHash({
        id: ulid(),
        iv,
        blob,
        accountIdHash,
        createdAt: now,
        updatedAt: now,
        expiresAt,
      });

      const jwt = await issueSessionJwt({
        recordId: resolved.id,
        recordKey,
        provider: session.providerId,
        secret: deps.jwtSecret,
      });

      const accepted = updateSession(sessionId, { status: "complete", jwt });
      if (!accepted) {
        // Another concurrent poll already drove this session to a terminal
        // state. Return whatever the session now holds rather than racing
        // it: the user must see one consistent answer regardless of which
        // poll arrives back at the client first.
        const final = getSession(sessionId);
        if (final?.status === "complete" && final.jwt) {
          return c.json({ status: "complete", jwt: final.jwt });
        }
        if (final?.status === "error") {
          return c.json({ status: "error", error: final.error });
        }
      }
      return c.json({ status: "complete", jwt });
    } catch (err) {
      const message = errorMessage(err);
      const accepted = updateSession(sessionId, { status: "error", error: message });
      if (!accepted) {
        // Another concurrent poll already completed (or already errored).
        // Surface that terminal state instead of overwriting it with this
        // race's error.
        const final = getSession(sessionId);
        if (final?.status === "complete" && final.jwt) {
          return c.json({ status: "complete", jwt: final.jwt });
        }
      }
      return c.json({ status: "error", error: message });
    }
  });

  app.post("/revoke", async (c) => {
    const auth = c.req.header("Authorization") || "";
    const match = auth.match(/^Bearer\s+(.+)$/i);
    if (!match) return c.json({ error: "missing bearer token" }, 401);
    try {
      const verified = await verifySessionJwt(match[1]!, deps.jwtSecret);
      await deps.store.delete(verified.recordId);
      return c.body(null, 204);
    } catch (err) {
      return c.json({ error: errorMessage(err) }, 401);
    }
  });

  /**
   * GET /auth/whoami
   *
   * Returns the user identity bound to a session JWT without revealing any
   * provider-internal account IDs or the underlying OAuth tokens.
   *
   * Security notes:
   *   - All failure modes return identical 401 to avoid a record / decryption /
   *     provider-mismatch oracle. Server-side logs preserve distinction.
   *   - identityId is HMAC-SHA256(IDENTITY_SECRET, provider || \0 || accountId),
   *     namespaced per provider, opaque to the caller, reversible only with the
   *     identity secret.
   *   - The endpoint does not refresh OAuth tokens or call the provider.
   */
  app.get("/whoami", async (c) => {
    const fail = () => c.json({ error: "unauthorized" }, 401);
    const auth = c.req.header("Authorization") || "";
    const match = auth.match(/^Bearer\s+(.+)$/i);
    if (!match) return fail();

    try {
      const verified = await verifySessionJwt(match[1]!, deps.jwtSecret);
      const record = await deps.store.get(verified.recordId);
      if (!record) return fail();
      const decrypted = decryptJson<DecryptedRecord>(verified.recordKey, {
        iv: record.iv,
        blob: record.blob,
      });
      if (decrypted.provider !== verified.provider) return fail();

      const id = identityId(deps.identitySecret, decrypted.provider, decrypted.accountId);
      const payload = JSON.parse(
        Buffer.from(match[1]!.split(".")[1]!, "base64url").toString("utf-8"),
      ) as { exp?: number };

      return c.json({
        user: { id, provider: decrypted.provider },
        session: { expires: typeof payload.exp === "number" ? payload.exp : null },
      });
    } catch {
      return fail();
    }
  });

  app.get("/providers", (c) => {
    const ids: ProviderId[] = ["openai", "xai", "github"];
    return c.json({
      providers: ids.map((id) => {
        const a = getProvider(id);
        return { id: a.id, displayName: a.displayName };
      }),
    });
  });

  return app;
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
