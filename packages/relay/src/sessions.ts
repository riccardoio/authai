import { randomUUID } from "node:crypto";
import type { ProviderId } from "./providers/types.js";

export type Session = {
  id: string;
  providerId: ProviderId;
  deviceAuthId: string;
  userCode: string;
  pollIntervalMs: number;
  expiresAt: number;
  status: "pending" | "complete" | "expired" | "error";
  jwt?: string;
  error?: string;
  /**
   * Cloud-edition only. The appId of the tenant that created this session.
   * Pinned at creation so a subsequent poll under a different tenant
   * (e.g., guessed sessionId from another app) cannot reuse it.
   * Undefined in community edition where there is no tenant scoping.
   */
  appId?: string;
};

const TTL_MS = 15 * 60 * 1000;
const sessions = new Map<string, Session>();

export function createSession(params: {
  providerId: ProviderId;
  deviceAuthId: string;
  userCode: string;
  pollIntervalMs: number;
  expiresInMs: number;
  appId?: string;
}): Session {
  const id = randomUUID();
  const session: Session = {
    id,
    providerId: params.providerId,
    deviceAuthId: params.deviceAuthId,
    userCode: params.userCode,
    pollIntervalMs: params.pollIntervalMs,
    expiresAt: Date.now() + Math.min(TTL_MS, params.expiresInMs),
    status: "pending",
    appId: params.appId,
  };
  sessions.set(id, session);
  return session;
}

export function getSession(id: string): Session | undefined {
  const s = sessions.get(id);
  if (!s) return undefined;
  if (s.status === "pending" && Date.now() > s.expiresAt) {
    s.status = "expired";
  }
  return s;
}

/**
 * Apply a patch to a session. Returns `true` if the patch was applied,
 * `false` if the patch was rejected. A `false` outcome means the session
 * already reached a terminal state — the caller raced another poll and
 * lost, and should return whatever the terminal session now holds rather
 * than overwriting it.
 *
 * Terminal states (`complete`, `error`, `expired`) cannot be overwritten
 * by another terminal state. Non-terminal updates (e.g. heartbeats) are
 * always applied while the session is still `pending`.
 */
export function updateSession(id: string, patch: Partial<Session>): boolean {
  const s = sessions.get(id);
  if (!s) return false;
  const isTerminalPatch =
    patch.status === "complete" || patch.status === "error" || patch.status === "expired";
  if (s.status !== "pending" && isTerminalPatch) {
    return false;
  }
  Object.assign(s, patch);
  return true;
}

setInterval(() => {
  const now = Date.now();
  for (const [id, s] of sessions) {
    if (now > s.expiresAt + 60 * 1000) {
      sessions.delete(id);
    }
  }
}, 60 * 1000).unref();
