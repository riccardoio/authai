import { Pool, type PoolConfig } from "pg";
import type { AuthRecord, AuthRecordStore, UpdatePatch } from "@authai/relay";

/**
 * Postgres implementation of @authai/relay's AuthRecordStore + the
 * cloud-edition admin stores (apps, audit_events). Same store interface
 * as @authai/relay-store-sqlite, so handlers don't care which backend
 * runs underneath. Use SQLite in single-tenant self-hosted deploys;
 * use this in cloud editions where multi-tenant traffic + shared
 * state across machines requires a real DB.
 *
 * Schema design notes:
 *
 *   - `auth_records` carries an optional `app_id`. Community-edition
 *     installs that hit Postgres (rare, but possible if a self-host wants
 *     Postgres without multi-tenancy) leave `app_id` NULL. The dedup
 *     constraint is on `(COALESCE(app_id, ''), account_id_hash)` so NULL
 *     and any specific app coexist.
 *
 *   - `apps` is the cloud-edition tenant table. Origin and api_key are
 *     unique. A `revoked_at` column gates subsequent tenant lookups —
 *     `getByApiKeyHash` and `getByOrigin` already filter `revoked_at IS
 *     NULL` in SQL, so a revoke from the dashboard takes effect on the
 *     next request. Existing JWTs minted before revocation keep their
 *     signature validity until expiry — revoking the app blocks the
 *     tenant lookup, but a JWT in flight that's about to hit
 *     /auth/whoami or /v1/* finds no tenant and gets the standard
 *     uniform 401 from tenantMiddleware.
 *
 *   - `audit_events` is append-only. No update path. `payload` is JSON
 *     (jsonb) so we can read structured fields back later.
 */

const SCHEMA = `
CREATE TABLE IF NOT EXISTS auth_records (
  id               TEXT      PRIMARY KEY,
  iv               BYTEA     NOT NULL,
  blob             BYTEA     NOT NULL,
  account_id_hash  TEXT      NOT NULL,
  app_id           TEXT,
  created_at       BIGINT    NOT NULL,
  updated_at       BIGINT    NOT NULL,
  expires_at       BIGINT    NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS auth_records_by_account
  ON auth_records (COALESCE(app_id, ''), account_id_hash);
CREATE INDEX IF NOT EXISTS auth_records_by_expires
  ON auth_records (expires_at);
CREATE INDEX IF NOT EXISTS auth_records_by_app
  ON auth_records (app_id) WHERE app_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS apps (
  id                 TEXT      PRIMARY KEY,
  api_key_hash       TEXT      NOT NULL UNIQUE,
  origin             TEXT      NOT NULL UNIQUE,
  name               TEXT      NOT NULL,
  owner_github_id    TEXT      NOT NULL,
  owner_email        TEXT,
  origin_verified    BOOLEAN   NOT NULL DEFAULT FALSE,
  origin_verified_at BIGINT,
  origin_verify_token TEXT     NOT NULL,
  rate_limit_per_min INTEGER   NOT NULL DEFAULT 60,
  daily_request_cap  INTEGER   NOT NULL DEFAULT 1000,
  revoked_at         BIGINT,
  created_at         BIGINT    NOT NULL,
  updated_at         BIGINT    NOT NULL
);
CREATE INDEX IF NOT EXISTS apps_by_owner ON apps (owner_github_id);

CREATE TABLE IF NOT EXISTS audit_events (
  id          TEXT      PRIMARY KEY,
  ts          BIGINT    NOT NULL,
  actor_type  TEXT      NOT NULL,
  actor_id    TEXT      NOT NULL,
  app_id      TEXT,
  event_type  TEXT      NOT NULL,
  payload     JSONB     NOT NULL
);
CREATE INDEX IF NOT EXISTS audit_events_by_app
  ON audit_events (app_id, ts DESC);
CREATE INDEX IF NOT EXISTS audit_events_by_ts
  ON audit_events (ts DESC);
`;

export type AppRow = {
  id: string;
  apiKeyHash: string;
  origin: string;
  name: string;
  ownerGithubId: string;
  ownerEmail?: string;
  originVerified: boolean;
  originVerifiedAt?: number;
  originVerifyToken: string;
  rateLimitPerMin: number;
  dailyRequestCap: number;
  revokedAt?: number;
  createdAt: number;
  updatedAt: number;
};

export type AuditEvent = {
  id: string;
  ts: number;
  actorType: "user" | "owner" | "operator" | "system" | "origin_change";
  actorId: string;
  appId?: string;
  eventType: string;
  payload: Record<string, unknown>;
};

export interface AppStore {
  /** Create or replace an app row. Returns the row as written. */
  create(app: Omit<AppRow, "createdAt" | "updatedAt"> & { createdAt?: number; updatedAt?: number }): Promise<AppRow>;

  /** Lookup by API key hash. Returns null on miss or revoked app. */
  getByApiKeyHash(apiKeyHash: string): Promise<AppRow | null>;

  /** Lookup by origin (exact match). Returns null on miss or revoked app. */
  getByOrigin(origin: string): Promise<AppRow | null>;

  /** Lookup by primary key. Returns the row even if revoked (for audit). */
  getById(id: string): Promise<AppRow | null>;

  /** List all apps owned by a GitHub identity. Excludes revoked. */
  listByOwner(ownerGithubId: string): Promise<AppRow[]>;

  /** Update origin verification state. */
  setOriginVerified(id: string, verified: boolean, verifiedAt: number): Promise<void>;

  /** Revoke an app — sets revoked_at; subsequent lookups by origin/key return null. */
  revoke(id: string, revokedAt: number): Promise<void>;
}

export interface AuditEventStore {
  /** Append-only write. */
  write(event: AuditEvent): Promise<void>;

  /** List events for an app, newest first, capped at `limit`. */
  listByApp(appId: string, limit?: number): Promise<AuditEvent[]>;
}

export type PostgresStore = AuthRecordStore & {
  apps: AppStore;
  audit: AuditEventStore;
};

export type CreatePostgresStoreOptions = PoolConfig & {
  /**
   * Skip running the bootstrap schema (CREATE TABLE IF NOT EXISTS ...).
   * Useful for environments where migrations are run separately (e.g., Fly
   * launch scripts) and the runtime user shouldn't have DDL privileges.
   */
  skipSchema?: boolean;
};

export async function createPostgresStore(
  options: CreatePostgresStoreOptions,
): Promise<PostgresStore> {
  const { skipSchema, ...poolConfig } = options;
  const pool = new Pool(poolConfig);

  if (!skipSchema) {
    await pool.query(SCHEMA);
  }

  const apps: AppStore = {
    async create(app) {
      const now = Date.now();
      const createdAt = app.createdAt ?? now;
      const updatedAt = app.updatedAt ?? now;
      const result = await pool.query<AppRowSql>(
        `INSERT INTO apps
           (id, api_key_hash, origin, name, owner_github_id, owner_email,
            origin_verified, origin_verified_at, origin_verify_token,
            rate_limit_per_min, daily_request_cap, revoked_at,
            created_at, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
         RETURNING *`,
        [
          app.id,
          app.apiKeyHash,
          app.origin,
          app.name,
          app.ownerGithubId,
          app.ownerEmail ?? null,
          app.originVerified,
          app.originVerifiedAt ?? null,
          app.originVerifyToken,
          app.rateLimitPerMin,
          app.dailyRequestCap,
          app.revokedAt ?? null,
          createdAt,
          updatedAt,
        ],
      );
      return rowToApp(result.rows[0]!);
    },

    async getByApiKeyHash(apiKeyHash) {
      const result = await pool.query<AppRowSql>(
        `SELECT * FROM apps WHERE api_key_hash = $1 AND revoked_at IS NULL`,
        [apiKeyHash],
      );
      return result.rows[0] ? rowToApp(result.rows[0]) : null;
    },

    async getByOrigin(origin) {
      const result = await pool.query<AppRowSql>(
        `SELECT * FROM apps WHERE origin = $1 AND revoked_at IS NULL`,
        [origin],
      );
      return result.rows[0] ? rowToApp(result.rows[0]) : null;
    },

    async getById(id) {
      const result = await pool.query<AppRowSql>(
        `SELECT * FROM apps WHERE id = $1`,
        [id],
      );
      return result.rows[0] ? rowToApp(result.rows[0]) : null;
    },

    async listByOwner(ownerGithubId) {
      const result = await pool.query<AppRowSql>(
        `SELECT * FROM apps WHERE owner_github_id = $1 AND revoked_at IS NULL
         ORDER BY created_at DESC`,
        [ownerGithubId],
      );
      return result.rows.map(rowToApp);
    },

    async setOriginVerified(id, verified, verifiedAt) {
      await pool.query(
        `UPDATE apps SET origin_verified = $2, origin_verified_at = $3,
                         updated_at = $4
           WHERE id = $1`,
        [id, verified, verifiedAt, Date.now()],
      );
    },

    async revoke(id, revokedAt) {
      await pool.query(
        `UPDATE apps SET revoked_at = $2, updated_at = $3 WHERE id = $1`,
        [id, revokedAt, Date.now()],
      );
    },
  };

  const audit: AuditEventStore = {
    async write(event) {
      await pool.query(
        `INSERT INTO audit_events
           (id, ts, actor_type, actor_id, app_id, event_type, payload)
         VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [
          event.id,
          event.ts,
          event.actorType,
          event.actorId,
          event.appId ?? null,
          event.eventType,
          event.payload,
        ],
      );
    },

    async listByApp(appId, limit = 100) {
      const result = await pool.query<AuditEventSql>(
        `SELECT * FROM audit_events WHERE app_id = $1
           ORDER BY ts DESC LIMIT $2`,
        [appId, limit],
      );
      return result.rows.map(rowToAuditEvent);
    },
  };

  const store: AuthRecordStore = {
    async upsertByAccountHash(c: AuthRecord) {
      // Use COALESCE on app_id to fall under the same unique constraint
      // that includes both NULL (community) and any specific app_id rows.
      const result = await pool.query<{ id: string; created_at: string }>(
        `INSERT INTO auth_records
           (id, iv, blob, account_id_hash, app_id, created_at, updated_at, expires_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
         ON CONFLICT (COALESCE(app_id, ''), account_id_hash) DO UPDATE SET
           iv         = EXCLUDED.iv,
           blob       = EXCLUDED.blob,
           updated_at = EXCLUDED.updated_at,
           expires_at = EXCLUDED.expires_at
         RETURNING id, created_at`,
        [
          c.id,
          Buffer.from(c.iv),
          Buffer.from(c.blob),
          c.accountIdHash,
          c.appId ?? null,
          c.createdAt,
          c.updatedAt,
          c.expiresAt,
        ],
      );
      const row = result.rows[0]!;
      return { id: row.id, createdAt: Number(row.created_at) };
    },

    async get(id) {
      const result = await pool.query<AuthRecordSql>(
        `SELECT * FROM auth_records WHERE id = $1`,
        [id],
      );
      return result.rows[0] ? rowToRecord(result.rows[0]) : null;
    },

    async update(id, patch: UpdatePatch, expectedUpdatedAt) {
      const result = await pool.query(
        `UPDATE auth_records
            SET iv         = $2,
                blob       = $3,
                updated_at = $4,
                expires_at = COALESCE($5, expires_at)
          WHERE id = $1
            AND updated_at = $6`,
        [
          id,
          Buffer.from(patch.iv),
          Buffer.from(patch.blob),
          patch.updatedAt,
          patch.expiresAt ?? null,
          expectedUpdatedAt,
        ],
      );
      return (result.rowCount ?? 0) > 0;
    },

    async delete(id) {
      await pool.query(`DELETE FROM auth_records WHERE id = $1`, [id]);
    },

    async sweepExpired(now: number) {
      const result = await pool.query(
        `DELETE FROM auth_records WHERE expires_at < $1`,
        [now],
      );
      return result.rowCount ?? 0;
    },

    async close() {
      await pool.end();
    },
  };

  return Object.assign(store, { apps, audit });
}

type AuthRecordSql = {
  id: string;
  iv: Buffer;
  blob: Buffer;
  account_id_hash: string;
  app_id: string | null;
  created_at: string;
  updated_at: string;
  expires_at: string;
};

type AppRowSql = {
  id: string;
  api_key_hash: string;
  origin: string;
  name: string;
  owner_github_id: string;
  owner_email: string | null;
  origin_verified: boolean;
  origin_verified_at: string | null;
  origin_verify_token: string;
  rate_limit_per_min: number;
  daily_request_cap: number;
  revoked_at: string | null;
  created_at: string;
  updated_at: string;
};

type AuditEventSql = {
  id: string;
  ts: string;
  actor_type: string;
  actor_id: string;
  app_id: string | null;
  event_type: string;
  payload: Record<string, unknown>;
};

function rowToRecord(row: AuthRecordSql): AuthRecord {
  return {
    id: row.id,
    iv: new Uint8Array(row.iv),
    blob: new Uint8Array(row.blob),
    accountIdHash: row.account_id_hash,
    appId: row.app_id ?? undefined,
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at),
    expiresAt: Number(row.expires_at),
  };
}

function rowToApp(row: AppRowSql): AppRow {
  return {
    id: row.id,
    apiKeyHash: row.api_key_hash,
    origin: row.origin,
    name: row.name,
    ownerGithubId: row.owner_github_id,
    ownerEmail: row.owner_email ?? undefined,
    originVerified: row.origin_verified,
    originVerifiedAt: row.origin_verified_at ? Number(row.origin_verified_at) : undefined,
    originVerifyToken: row.origin_verify_token,
    rateLimitPerMin: row.rate_limit_per_min,
    dailyRequestCap: row.daily_request_cap,
    revokedAt: row.revoked_at ? Number(row.revoked_at) : undefined,
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at),
  };
}

function rowToAuditEvent(row: AuditEventSql): AuditEvent {
  return {
    id: row.id,
    ts: Number(row.ts),
    actorType: row.actor_type as AuditEvent["actorType"],
    actorId: row.actor_id,
    appId: row.app_id ?? undefined,
    eventType: row.event_type,
    payload: row.payload,
  };
}
