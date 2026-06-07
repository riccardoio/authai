export type AuthRecord = {
  id: string;
  iv: Uint8Array;
  blob: Uint8Array;
  accountIdHash: string;
  /**
   * Cloud-edition only. Identifies which app owns this record. The same
   * upstream provider account signing into two different apps produces
   * two distinct rows because (a) the accountIdHash differs per app
   * (per-app identitySecret) and (b) the appId column differs.
   *
   * Community-edition (single-tenant) stores undefined.
   *
   * The store's `upsertByAccountHash` MUST treat appId as part of the
   * dedup key — community edition uses NULL semantics so existing
   * single-tenant data keeps working without migration.
   */
  appId?: string;
  createdAt: number;
  updatedAt: number;
  expiresAt: number;
};

export type UpdatePatch = {
  iv: Uint8Array;
  blob: Uint8Array;
  updatedAt: number;
  expiresAt?: number;
};

export interface AuthRecordStore {
  /**
   * Atomically insert a new record, or replace the encrypted payload of an
   * existing record matching the same `accountIdHash`. The record `id` and
   * `createdAt` of an existing row are preserved; the candidate's `iv`,
   * `blob`, `updatedAt`, and `expiresAt` overwrite. Returns the resolved row's
   * `id` and `createdAt` so the caller can issue a session JWT bound to
   * whichever row actually persisted.
   *
   * Replaces the previous `findByAccountHash + put` two-step, which had a
   * lost-update / duplicate-insert window under concurrent sign-ins for the
   * same provider account.
   */
  upsertByAccountHash(candidate: AuthRecord): Promise<{ id: string; createdAt: number }>;

  /** Load a record by primary key. Returns `null` if not found. */
  get(id: string): Promise<AuthRecord | null>;

  /**
   * Compare-and-swap update. Applies `patch` only if the row's stored
   * `updated_at` still equals `expectedUpdatedAt`. Returns `true` if the
   * row was updated, `false` if another writer updated the row in between
   * (stale). On `false` the caller should re-read and either retry or
   * surface a conflict — never overwrite with a stale ciphertext.
   */
  update(
    id: string,
    patch: UpdatePatch,
    expectedUpdatedAt: number,
  ): Promise<boolean>;

  delete(id: string): Promise<void>;
  sweepExpired(now: number): Promise<number>;
  close(): Promise<void>;
}
