import { randomUUID } from "node:crypto";

export type Session = {
  id: string;
  deviceAuthId: string;
  userCode: string;
  pollIntervalMs: number;
  expiresAt: number;
  status: "pending" | "complete" | "expired" | "error";
  jwt?: string;
  error?: string;
};

const TTL_MS = 15 * 60 * 1000;
const sessions = new Map<string, Session>();

export function createSession(params: {
  deviceAuthId: string;
  userCode: string;
  pollIntervalMs: number;
}): Session {
  const id = randomUUID();
  const session: Session = {
    id,
    deviceAuthId: params.deviceAuthId,
    userCode: params.userCode,
    pollIntervalMs: params.pollIntervalMs,
    expiresAt: Date.now() + TTL_MS,
    status: "pending",
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

export function updateSession(id: string, patch: Partial<Session>): void {
  const s = sessions.get(id);
  if (!s) return;
  Object.assign(s, patch);
}

setInterval(() => {
  const now = Date.now();
  for (const [id, s] of sessions) {
    if (now > s.expiresAt + 60 * 1000) {
      sessions.delete(id);
    }
  }
}, 60 * 1000).unref();
