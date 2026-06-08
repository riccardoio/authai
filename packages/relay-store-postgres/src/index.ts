import { randomBytes } from "node:crypto";
import { Pool, type PoolClient, type PoolConfig } from "pg";
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
 *
 *   - `app_origins` tracks per-app allowed origins with tier classification
 *     (localhost / preview / production). Supports both secret and
 *     publishable-key credential models.
 *
 *   - `app_publishable_keys` stores hashed publishable keys for browser-direct
 *     flows. The split-key model means the raw key is never stored server-side.
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
  updated_at         BIGINT    NOT NULL,
  credential_type    TEXT      NOT NULL DEFAULT 'secret',
  browser_direct_enabled BOOLEAN NOT NULL DEFAULT TRUE
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

CREATE TABLE IF NOT EXISTS app_origins (
  id            TEXT      PRIMARY KEY,
  app_id        TEXT      NOT NULL REFERENCES apps(id) ON DELETE CASCADE,
  origin        TEXT      NOT NULL UNIQUE,
  tier          TEXT      NOT NULL,
  status        TEXT      NOT NULL DEFAULT 'active',
  last_used_at  BIGINT,
  last_used_ip  TEXT,
  created_at    BIGINT    NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_app_origins_app_id ON app_origins(app_id);
CREATE INDEX IF NOT EXISTS idx_app_origins_origin ON app_origins(origin);

CREATE TABLE IF NOT EXISTS app_publishable_keys (
  id            TEXT      PRIMARY KEY,
  app_id        TEXT      NOT NULL REFERENCES apps(id) ON DELETE CASCADE,
  key_hash      TEXT      NOT NULL UNIQUE,
  label         TEXT,
  status        TEXT      NOT NULL DEFAULT 'active',
  created_at    BIGINT    NOT NULL,
  created_by    TEXT,
  revoked_at    BIGINT,
  revoked_by    TEXT,
  last_used_at  BIGINT,
  last_used_ip  TEXT
);
CREATE INDEX IF NOT EXISTS idx_apk_app_id ON app_publishable_keys(app_id);
`;

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type CredentialType = "secret" | "publishable";
export type OriginStatus = "active" | "disabled";
export type OriginTier = "localhost" | "preview" | "production";
export type PublishableKeyStatus = "active" | "revoked";

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
  credentialType: CredentialType;
  browserDirectEnabled: boolean;
};

export type OriginRow = {
  id: string;
  appId: string;
  origin: string;
  tier: OriginTier;
  status: OriginStatus;
  lastUsedAt?: number;
  lastUsedIp?: string;
  createdAt: number;
};

export type PublishableKeyRow = {
  id: string;
  appId: string;
  keyHash: string;
  label?: string;
  status: PublishableKeyStatus;
  createdAt: number;
  createdBy?: string;
  revokedAt?: number;
  revokedBy?: string;
  lastUsedAt?: number;
  lastUsedIp?: string;
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

// ---------------------------------------------------------------------------
// Shared AppStore interface — the contract both Postgres and SQLite stores
// satisfy. Defined here (canonical cloud-edition store).
// ---------------------------------------------------------------------------

export interface AppStore {
  apps: {
    create(opts: {
      id: string;
      apiKeyHash: string;
      origin: string;
      name: string;
      ownerGithubId: string;
      ownerEmail?: string;
      originVerifyToken: string;
      rateLimitPerMin?: number;
      dailyRequestCap?: number;
      credentialType?: CredentialType;
      browserDirectEnabled?: boolean;
    }): Promise<AppRow>;
    /**
     * Atomically creates an app + initial origin + initial publishable key in
     * a single transaction. Prevents orphan apps from partial failures.
     * Returns the created AppRow and the plaintext key (caller must show it once).
     */
    createPublishable(opts: {
      id: string;
      apiKeyHash: string;
      origin: string;
      originTier: OriginTier;
      name: string;
      ownerGithubId: string;
      ownerEmail?: string;
      pkHash: string;
      pkLabel?: string;
    }): Promise<{ app: AppRow; originRow: OriginRow; keyRow: PublishableKeyRow }>;
    getById(id: string): Promise<AppRow | null>;
    getByApiKeyHash(hash: string): Promise<AppRow | null>;
    getByOrigin(origin: string): Promise<AppRow | null>;
    listByOwner(ownerGithubId: string): Promise<AppRow[]>;
    setOriginVerified(id: string, verified: boolean, verifiedAt: number): Promise<void>;
    revoke(id: string, revokedAt: number): Promise<void>;
  };
  origins: {
    add(opts: { appId: string; origin: string; tier: OriginTier }): Promise<OriginRow>;
    listForApp(appId: string): Promise<OriginRow[]>;
    getAppByActiveOrigin(origin: string): Promise<AppRow | null>;
    setStatus(originId: string, status: OriginStatus): Promise<void>;
    /** App-scoped variant: only mutates if the row belongs to appId. Returns true on match+mutate, false on no-match. */
    setStatusForApp(appId: string, originId: string, status: OriginStatus): Promise<boolean>;
    remove(originId: string): Promise<void>;
    /** App-scoped variant: only deletes if the row belongs to appId. Returns true on match+delete, false on no-match. */
    removeForApp(appId: string, originId: string): Promise<boolean>;
    recordUsage(originId: string, ip: string): Promise<void>;
  };
  publishableKeys: {
    create(opts: {
      appId: string;
      keyHash: string;
      label?: string;
      createdBy?: string;
    }): Promise<PublishableKeyRow>;
    listForApp(appId: string): Promise<PublishableKeyRow[]>;
    getActiveByHash(hash: string): Promise<{ app: AppRow; key: PublishableKeyRow } | null>;
    revoke(keyId: string, actorGhId: string): Promise<void>;
    /** App-scoped variant: only revokes if the key belongs to appId. Returns true on match+revoke, false on no-match. */
    revokeForApp(appId: string, keyId: string, actorGhId: string): Promise<boolean>;
    recordUsage(keyId: string, ip: string): Promise<void>;
  };
}

// Flat admin interface used internally by createPostgresStore / PostgresStore.
// Kept for backward compatibility with existing cloud-relay-server usage.
export interface AppAdminStore {
  /** Create or replace an app row. Returns the row as written. */
  create(app: Omit<AppRow, "createdAt" | "updatedAt" | "credentialType" | "browserDirectEnabled"> & {
    createdAt?: number;
    updatedAt?: number;
    credentialType?: CredentialType;
    browserDirectEnabled?: boolean;
  }): Promise<AppRow>;

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
  apps: AppAdminStore;
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

// ---------------------------------------------------------------------------
// Typed DB row shapes (Postgres returns snake_case column names)
// ---------------------------------------------------------------------------

interface DbAppRow {
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
  credential_type: string;
  browser_direct_enabled: boolean;
}

interface DbOriginRow {
  id: string;
  app_id: string;
  origin: string;
  tier: string;
  status: string;
  last_used_at: string | null;
  last_used_ip: string | null;
  created_at: string;
}

interface DbPublishableKeyRow {
  id: string;
  app_id: string;
  key_hash: string;
  label: string | null;
  status: string;
  created_at: string;
  created_by: string | null;
  revoked_at: string | null;
  revoked_by: string | null;
  last_used_at: string | null;
  last_used_ip: string | null;
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

type AuditEventSql = {
  id: string;
  ts: string;
  actor_type: string;
  actor_id: string;
  app_id: string | null;
  event_type: string;
  payload: Record<string, unknown>;
};

// ---------------------------------------------------------------------------
// Row mapper functions
// ---------------------------------------------------------------------------

function rowToApp(row: DbAppRow): AppRow {
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
    credentialType: row.credential_type as CredentialType,
    browserDirectEnabled: row.browser_direct_enabled,
  };
}

function rowToOrigin(row: DbOriginRow): OriginRow {
  return {
    id: row.id,
    appId: row.app_id,
    origin: row.origin,
    tier: row.tier as OriginTier,
    status: row.status as OriginStatus,
    lastUsedAt: row.last_used_at ? Number(row.last_used_at) : undefined,
    lastUsedIp: row.last_used_ip ?? undefined,
    createdAt: Number(row.created_at),
  };
}

function rowToPublishableKey(row: DbPublishableKeyRow): PublishableKeyRow {
  return {
    id: row.id,
    appId: row.app_id,
    keyHash: row.key_hash,
    label: row.label ?? undefined,
    status: row.status as PublishableKeyStatus,
    createdAt: Number(row.created_at),
    createdBy: row.created_by ?? undefined,
    revokedAt: row.revoked_at ? Number(row.revoked_at) : undefined,
    revokedBy: row.revoked_by ?? undefined,
    lastUsedAt: row.last_used_at ? Number(row.last_used_at) : undefined,
    lastUsedIp: row.last_used_ip ?? undefined,
  };
}

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

// ---------------------------------------------------------------------------
// Migration — idempotent column additions for existing databases
// ---------------------------------------------------------------------------

async function migrateApps(client: PoolClient): Promise<void> {
  await client.query(`
    DO $$
    BEGIN
      IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                     WHERE table_name='apps' AND column_name='credential_type') THEN
        ALTER TABLE apps ADD COLUMN credential_type TEXT NOT NULL DEFAULT 'secret';
      END IF;
      IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                     WHERE table_name='apps' AND column_name='browser_direct_enabled') THEN
        ALTER TABLE apps ADD COLUMN browser_direct_enabled BOOLEAN NOT NULL DEFAULT TRUE;
      END IF;
    END$$;
  `);
}

// ---------------------------------------------------------------------------
// createPostgresStore — existing cloud-relay-server factory
// ---------------------------------------------------------------------------

export async function createPostgresStore(
  options: CreatePostgresStoreOptions,
): Promise<PostgresStore> {
  const { skipSchema, ...poolConfig } = options;
  const pool = new Pool(poolConfig);

  if (!skipSchema) {
    const client = await pool.connect();
    try {
      await client.query(SCHEMA);
      await migrateApps(client);
    } finally {
      client.release();
    }
  }

  const apps: AppAdminStore = {
    async create(app) {
      const now = Date.now();
      const createdAt = app.createdAt ?? now;
      const updatedAt = app.updatedAt ?? now;
      const ct = app.credentialType ?? "secret";
      const bde = app.browserDirectEnabled ?? true;
      const result = await pool.query<DbAppRow>(
        `INSERT INTO apps
           (id, api_key_hash, origin, name, owner_github_id, owner_email,
            origin_verified, origin_verified_at, origin_verify_token,
            rate_limit_per_min, daily_request_cap, revoked_at,
            created_at, updated_at, credential_type, browser_direct_enabled)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
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
          ct,
          bde,
        ],
      );
      return rowToApp(result.rows[0]!);
    },

    async getByApiKeyHash(apiKeyHash) {
      const result = await pool.query<DbAppRow>(
        `SELECT * FROM apps WHERE api_key_hash = $1 AND revoked_at IS NULL`,
        [apiKeyHash],
      );
      return result.rows[0] ? rowToApp(result.rows[0]) : null;
    },

    async getByOrigin(origin) {
      const result = await pool.query<DbAppRow>(
        `SELECT * FROM apps WHERE origin = $1 AND revoked_at IS NULL`,
        [origin],
      );
      return result.rows[0] ? rowToApp(result.rows[0]) : null;
    },

    async getById(id) {
      const result = await pool.query<DbAppRow>(
        `SELECT * FROM apps WHERE id = $1`,
        [id],
      );
      return result.rows[0] ? rowToApp(result.rows[0]) : null;
    },

    async listByOwner(ownerGithubId) {
      const result = await pool.query<DbAppRow>(
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

  const authStore: AuthRecordStore = {
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

  return Object.assign(authStore, { apps, audit });
}

// ---------------------------------------------------------------------------
// createStore — namespaced factory matching the AppStore interface.
// Used by cloud-codegen flows that need origins + publishableKeys namespaces.
// ---------------------------------------------------------------------------

export async function createStore(opts: { url: string }): Promise<AppStore & { _pool: Pool }> {
  const pool = new Pool({ connectionString: opts.url });

  const client = await pool.connect();
  try {
    await client.query(SCHEMA);
    await migrateApps(client);
  } finally {
    client.release();
  }

  const store: AppStore & { _pool: Pool } = {
    _pool: pool,

    apps: {
      async create(o) {
        const now = Date.now();
        const ct = o.credentialType ?? "secret";
        const bde = o.browserDirectEnabled ?? true;
        const { rows } = await pool.query<DbAppRow>(
          `INSERT INTO apps (
            id, api_key_hash, origin, name, owner_github_id, owner_email,
            origin_verified, origin_verified_at, origin_verify_token,
            rate_limit_per_min, daily_request_cap, revoked_at,
            created_at, updated_at,
            credential_type, browser_direct_enabled
          ) VALUES ($1, $2, $3, $4, $5, $6, FALSE, NULL, $7, $8, $9, NULL, $10, $11, $12, $13)
          RETURNING *`,
          [
            o.id,
            o.apiKeyHash,
            o.origin,
            o.name,
            o.ownerGithubId,
            o.ownerEmail ?? null,
            o.originVerifyToken,
            o.rateLimitPerMin ?? 60,
            o.dailyRequestCap ?? 1000,
            now,
            now,
            ct,
            bde,
          ],
        );
        return rowToApp(rows[0]!);
      },

      async getById(id) {
        const { rows } = await pool.query<DbAppRow>(
          "SELECT * FROM apps WHERE id = $1",
          [id],
        );
        return rows[0] ? rowToApp(rows[0]) : null;
      },

      async getByApiKeyHash(hash) {
        const { rows } = await pool.query<DbAppRow>(
          "SELECT * FROM apps WHERE api_key_hash = $1 AND revoked_at IS NULL",
          [hash],
        );
        return rows[0] ? rowToApp(rows[0]) : null;
      },

      async getByOrigin(origin) {
        const { rows } = await pool.query<DbAppRow>(
          "SELECT * FROM apps WHERE origin = $1 AND revoked_at IS NULL",
          [origin],
        );
        return rows[0] ? rowToApp(rows[0]) : null;
      },

      async listByOwner(ownerGithubId) {
        const { rows } = await pool.query<DbAppRow>(
          "SELECT * FROM apps WHERE owner_github_id = $1 AND revoked_at IS NULL ORDER BY created_at DESC",
          [ownerGithubId],
        );
        return rows.map(rowToApp);
      },

      async setOriginVerified(id, verified, verifiedAt) {
        await pool.query(
          "UPDATE apps SET origin_verified = $2, origin_verified_at = $3, updated_at = $4 WHERE id = $1",
          [id, verified, verifiedAt, Date.now()],
        );
      },

      async revoke(id, revokedAt) {
        await pool.query(
          "UPDATE apps SET revoked_at = $2, updated_at = $3 WHERE id = $1",
          [id, revokedAt, Date.now()],
        );
      },

      async createPublishable(o) {
        const now = Date.now();
        const originId = `org_${randomBytes(10).toString("hex")}`;
        const keyId = `pk_${randomBytes(10).toString("hex")}`;
        const client = await pool.connect();
        try {
          await client.query("BEGIN");
          const { rows: appRows } = await client.query<DbAppRow>(
            `INSERT INTO apps (
              id, api_key_hash, origin, name, owner_github_id, owner_email,
              origin_verified, origin_verified_at, origin_verify_token,
              rate_limit_per_min, daily_request_cap, revoked_at,
              created_at, updated_at, credential_type, browser_direct_enabled
            ) VALUES ($1, $2, $3, $4, $5, $6, FALSE, NULL, 'unused-publishable', 60, 1000, NULL, $7, $8, 'publishable', TRUE)
            RETURNING *`,
            [o.id, o.apiKeyHash, o.origin, o.name, o.ownerGithubId, o.ownerEmail ?? null, now, now],
          );
          await client.query(
            `INSERT INTO app_origins (id, app_id, origin, tier, status, created_at)
             VALUES ($1, $2, $3, $4, 'active', $5)`,
            [originId, o.id, o.origin, o.originTier, now],
          );
          await client.query(
            `INSERT INTO app_publishable_keys
               (id, app_id, key_hash, label, status, created_at, created_by)
             VALUES ($1, $2, $3, $4, 'active', $5, $6)`,
            [keyId, o.id, o.pkHash, o.pkLabel ?? null, now, o.ownerGithubId],
          );
          await client.query("COMMIT");
          const app = rowToApp(appRows[0]!);
          const originRow: OriginRow = {
            id: originId, appId: o.id, origin: o.origin, tier: o.originTier,
            status: "active", createdAt: now,
          };
          const keyRow: PublishableKeyRow = {
            id: keyId, appId: o.id, keyHash: o.pkHash, label: o.pkLabel,
            status: "active", createdAt: now, createdBy: o.ownerGithubId,
          };
          return { app, originRow, keyRow };
        } catch (err) {
          await client.query("ROLLBACK");
          throw err;
        } finally {
          client.release();
        }
      },
    },

    origins: {
      async add(o) {
        const id = `org_${randomBytes(10).toString("hex")}`;
        const now = Date.now();
        await pool.query(
          `INSERT INTO app_origins (id, app_id, origin, tier, status, created_at)
           VALUES ($1, $2, $3, $4, 'active', $5)`,
          [id, o.appId, o.origin, o.tier, now],
        );
        return {
          id,
          appId: o.appId,
          origin: o.origin,
          tier: o.tier,
          status: "active",
          createdAt: now,
        };
      },

      async listForApp(appId) {
        const { rows } = await pool.query<DbOriginRow>(
          "SELECT * FROM app_origins WHERE app_id = $1 ORDER BY created_at ASC",
          [appId],
        );
        return rows.map(rowToOrigin);
      },

      async getAppByActiveOrigin(origin) {
        const { rows } = await pool.query<DbAppRow>(
          `SELECT a.* FROM apps a
           INNER JOIN app_origins o ON o.app_id = a.id
           WHERE o.origin = $1 AND o.status = 'active' AND a.revoked_at IS NULL
           LIMIT 1`,
          [origin],
        );
        return rows[0] ? rowToApp(rows[0]) : null;
      },

      async setStatus(originId, status) {
        await pool.query(
          "UPDATE app_origins SET status = $1 WHERE id = $2",
          [status, originId],
        );
      },

      async setStatusForApp(appId, originId, status) {
        const result = await pool.query(
          "UPDATE app_origins SET status = $1 WHERE id = $2 AND app_id = $3",
          [status, originId, appId],
        );
        return (result.rowCount ?? 0) > 0;
      },

      async remove(originId) {
        await pool.query("DELETE FROM app_origins WHERE id = $1", [originId]);
      },

      async removeForApp(appId, originId) {
        const result = await pool.query(
          "DELETE FROM app_origins WHERE id = $1 AND app_id = $2",
          [originId, appId],
        );
        return (result.rowCount ?? 0) > 0;
      },

      async recordUsage(originId, ip) {
        await pool.query(
          "UPDATE app_origins SET last_used_at = $1, last_used_ip = $2 WHERE id = $3",
          [Date.now(), ip, originId],
        );
      },
    },

    publishableKeys: {
      async create(o) {
        const id = `pk_${randomBytes(10).toString("hex")}`;
        const now = Date.now();
        await pool.query(
          `INSERT INTO app_publishable_keys
             (id, app_id, key_hash, label, status, created_at, created_by)
           VALUES ($1, $2, $3, $4, 'active', $5, $6)`,
          [id, o.appId, o.keyHash, o.label ?? null, now, o.createdBy ?? null],
        );
        return {
          id,
          appId: o.appId,
          keyHash: o.keyHash,
          label: o.label,
          status: "active",
          createdAt: now,
          createdBy: o.createdBy,
        };
      },

      async listForApp(appId) {
        const { rows } = await pool.query<DbPublishableKeyRow>(
          "SELECT * FROM app_publishable_keys WHERE app_id = $1 ORDER BY created_at DESC",
          [appId],
        );
        return rows.map(rowToPublishableKey);
      },

      async getActiveByHash(hash) {
        type JoinRow = DbAppRow & {
          k_id: string;
          k_app_id: string;
          k_key_hash: string;
          k_label: string | null;
          k_status: string;
          k_created_at: string;
          k_created_by: string | null;
          k_revoked_at: string | null;
          k_revoked_by: string | null;
          k_last_used_at: string | null;
          k_last_used_ip: string | null;
        };
        const { rows } = await pool.query<JoinRow>(
          `SELECT a.*,
                  k.id            AS k_id,
                  k.app_id        AS k_app_id,
                  k.key_hash      AS k_key_hash,
                  k.label         AS k_label,
                  k.status        AS k_status,
                  k.created_at    AS k_created_at,
                  k.created_by    AS k_created_by,
                  k.revoked_at    AS k_revoked_at,
                  k.revoked_by    AS k_revoked_by,
                  k.last_used_at  AS k_last_used_at,
                  k.last_used_ip  AS k_last_used_ip
           FROM app_publishable_keys k
           INNER JOIN apps a ON a.id = k.app_id
           WHERE k.key_hash = $1 AND k.status = 'active' AND a.revoked_at IS NULL
           LIMIT 1`,
          [hash],
        );
        if (!rows[0]) return null;
        const r = rows[0];
        const app = rowToApp(r);
        const key: PublishableKeyRow = {
          id: r.k_id,
          appId: r.k_app_id,
          keyHash: r.k_key_hash,
          label: r.k_label ?? undefined,
          status: r.k_status as PublishableKeyStatus,
          createdAt: Number(r.k_created_at),
          createdBy: r.k_created_by ?? undefined,
          revokedAt: r.k_revoked_at ? Number(r.k_revoked_at) : undefined,
          revokedBy: r.k_revoked_by ?? undefined,
          lastUsedAt: r.k_last_used_at ? Number(r.k_last_used_at) : undefined,
          lastUsedIp: r.k_last_used_ip ?? undefined,
        };
        return { app, key };
      },

      async revoke(keyId, actorGhId) {
        await pool.query(
          `UPDATE app_publishable_keys
           SET status = 'revoked', revoked_at = $1, revoked_by = $2
           WHERE id = $3 AND status = 'active'`,
          [Date.now(), actorGhId, keyId],
        );
      },

      async revokeForApp(appId, keyId, actorGhId) {
        const result = await pool.query(
          `UPDATE app_publishable_keys
           SET status = 'revoked', revoked_at = $1, revoked_by = $2
           WHERE id = $3 AND app_id = $4 AND status = 'active'`,
          [Date.now(), actorGhId, keyId, appId],
        );
        return (result.rowCount ?? 0) > 0;
      },

      async recordUsage(keyId, ip) {
        await pool.query(
          "UPDATE app_publishable_keys SET last_used_at = $1, last_used_ip = $2 WHERE id = $3",
          [Date.now(), ip, keyId],
        );
      },
    },
  };

  return store;
}
