import { getStore } from "./db.js";
import { ulid } from "ulid";

export async function writeAudit(opts: {
  appId: string;
  actorGhId: string;
  eventType: string;
  payload?: Record<string, unknown>;
  ip?: string;
}): Promise<void> {
  try {
    const store = await getStore();
    await store.audit.write({
      id: ulid(),
      ts: Date.now(),
      actorType: "owner",
      actorId: opts.actorGhId,
      appId: opts.appId,
      eventType: opts.eventType,
      payload: { ...opts.payload, ...(opts.ip ? { ip: opts.ip } : {}) },
    });
  } catch (err) {
    // Audit failures should not break user-facing actions.
    // eslint-disable-next-line no-console
    console.error("audit write failed:", err);
  }
}
