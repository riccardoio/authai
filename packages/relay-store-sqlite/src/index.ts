import Database from "better-sqlite3";
import { randomBytes } from "node:crypto";
import type { AuthRecord, AuthRecordStore, UpdatePatch } from "@authai/relay";

// ---------------------------------------------------------------------------
// Auth-record row shape (pre-existing)
// ---------------------------------------------------------------------------

type Row = {
  id: string;
  iv: Buffer;
  blob: Buffer;
  account_id_hash: string;
  created_at: number;
  updated_at: number;
  expires_at: number;
};

// Schema notes:
//
//   - `account_id_hash` has a UNIQUE index so two concurrent sign-ins for the
//     same provider account cannot create duplicate records. The upsert path
//     leans on this constraint via `INSERT ... ON CONFLICT(account_id_hash)`.
//
//   - Old (pre-Wave-2) databases shipped a non-unique index by the same
//     logical name. `migrateSchema()` below drops it and recreates as UNIQUE
//     on startup. The migration aborts if real duplicates exist; the operator
//     is expected to wipe or clean the row collisions first.
const SCHEMA = `
CREATE TABLE IF NOT EXISTS auth_records (
  id               TEXT    PRIMARY KEY,
  iv               BLOB    NOT NULL,
  blob             BLOB    NOT NULL,
  account_id_hash  TEXT    NOT NULL,
  created_at       INTEGER NOT NULL,
  updated_at       INTEGER NOT NULL,
  expires_at       INTEGER NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS auth_records_by_account
  ON auth_records (account_id_hash);
CREATE INDEX IF NOT EXISTS auth_records_by_expires
  ON auth_records (expires_at);
`;

function migrateSchema(db: Database.Database): void {
  // If the existing index isn't UNIQUE, drop and recreate. SQLite stores
  // index metadata in sqlite_master.
  type IndexRow = { name: string; sql: string | null };
  const row = db
    .prepare<[], IndexRow>(
      `SELECT name, sql FROM sqlite_master
       WHERE type='index' AND name='auth_records_by_account'`,
    )
    .get();
  if (row && row.sql && !/UNIQUE/i.test(row.sql)) {
    db.exec("DROP INDEX auth_records_by_account;");
  }
}

export function createSqliteStore(path: string): AuthRecordStore {
  const db = new Database(path);
  db.pragma("journal_mode = WAL");
  db.exec(SCHEMA);
  migrateSchema(db);
  // Re-run SCHEMA after a potential drop so the unique index is in place.
  db.exec(SCHEMA);

  type UpsertRow = { id: string; created_at: number };
  const upsertStmt = db.prepare<
    [string, Buffer, Buffer, string, number, number, number],
    UpsertRow
  >(
    `INSERT INTO auth_records
       (id, iv, blob, account_id_hash, created_at, updated_at, expires_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(account_id_hash) DO UPDATE SET
       iv         = excluded.iv,
       blob       = excluded.blob,
       updated_at = excluded.updated_at,
       expires_at = excluded.expires_at
     RETURNING id, created_at`,
  );

  const getById = db.prepare<[string], Row>(`SELECT * FROM auth_records WHERE id = ?`);

  // CAS update: the WHERE clause includes `updated_at = ?expected` so a
  // concurrent writer that already advanced updated_at sees 0 changes.
  const casUpdate = db.prepare<[Buffer, Buffer, number, number | null, string, number]>(
    `UPDATE auth_records
        SET iv         = ?,
            blob       = ?,
            updated_at = ?,
            expires_at = COALESCE(?, expires_at)
      WHERE id = ?
        AND updated_at = ?`,
  );

  const deleteStmt = db.prepare<[string]>(`DELETE FROM auth_records WHERE id = ?`);
  const sweep = db.prepare<[number]>(`DELETE FROM auth_records WHERE expires_at < ?`);

  return {
    async upsertByAccountHash(c: AuthRecord) {
      const row = upsertStmt.get(
        c.id,
        Buffer.from(c.iv),
        Buffer.from(c.blob),
        c.accountIdHash,
        c.createdAt,
        c.updatedAt,
        c.expiresAt,
      );
      if (!row) {
        // RETURNING should always produce a row on INSERT or DO UPDATE;
        // this branch is defensive against driver edge cases.
        throw new Error("upsertByAccountHash: no row returned");
      }
      return { id: row.id, createdAt: row.created_at };
    },

    async get(id: string) {
      const row = getById.get(id);
      return row ? rowToRecord(row) : null;
    },

    async update(id: string, patch: UpdatePatch, expectedUpdatedAt: number) {
      const info = casUpdate.run(
        Buffer.from(patch.iv),
        Buffer.from(patch.blob),
        patch.updatedAt,
        patch.expiresAt ?? null,
        id,
        expectedUpdatedAt,
      );
      return info.changes > 0;
    },

    async delete(id: string) {
      deleteStmt.run(id);
    },

    async sweepExpired(now: number) {
      return sweep.run(now).changes;
    },

    async close() {
      db.close();
    },
  };
}

function rowToRecord(row: Row): AuthRecord {
  return {
    id: row.id,
    iv: new Uint8Array(row.iv),
    blob: new Uint8Array(row.blob),
    accountIdHash: row.account_id_hash,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    expiresAt: row.expires_at,
  };
}

// ---------------------------------------------------------------------------
// AppStore — credential / publishable-key / origin tables
// ---------------------------------------------------------------------------

const APP_SCHEMA = `
CREATE TABLE IF NOT EXISTS apps (
  id                     TEXT    PRIMARY KEY,
  api_key_hash           TEXT    NOT NULL UNIQUE,
  origin                 TEXT    NOT NULL,
  name                   TEXT    NOT NULL,
  owner_github_id        TEXT    NOT NULL,
  owner_email            TEXT,
  origin_verified        INTEGER NOT NULL DEFAULT 0,
  origin_verified_at     INTEGER,
  origin_verify_token    TEXT    NOT NULL DEFAULT '',
  rate_limit_per_min     INTEGER NOT NULL DEFAULT 60,
  daily_request_cap      INTEGER NOT NULL DEFAULT 10000,
  revoked_at             INTEGER,
  created_at             INTEGER NOT NULL,
  updated_at             INTEGER NOT NULL,
  credential_type        TEXT    NOT NULL DEFAULT 'secret',
  browser_direct_enabled INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS app_origins (
  id            TEXT      PRIMARY KEY,
  app_id        TEXT      NOT NULL REFERENCES apps(id) ON DELETE CASCADE,
  origin        TEXT      NOT NULL UNIQUE,
  tier          TEXT      NOT NULL,
  status        TEXT      NOT NULL DEFAULT 'active',
  last_used_at  INTEGER,
  last_used_ip  TEXT,
  created_at    INTEGER   NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_app_origins_app_id ON app_origins(app_id);
CREATE INDEX IF NOT EXISTS idx_app_origins_origin ON app_origins(origin);

CREATE TABLE IF NOT EXISTS app_publishable_keys (
  id            TEXT      PRIMARY KEY,
  app_id        TEXT      NOT NULL REFERENCES apps(id) ON DELETE CASCADE,
  key_hash      TEXT      NOT NULL UNIQUE,
  label         TEXT,
  status        TEXT      NOT NULL DEFAULT 'active',
  created_at    INTEGER   NOT NULL,
  created_by    TEXT,
  revoked_at    INTEGER,
  revoked_by    TEXT,
  last_used_at  INTEGER,
  last_used_ip  TEXT
);
CREATE INDEX IF NOT EXISTS idx_apk_app_id ON app_publishable_keys(app_id);
`;

// Idempotent ALTER TABLE migrations for existing installs that predate the
// credential_type / browser_direct_enabled columns. SQLite throws
// "duplicate column name" on ALTER TABLE if the column already exists;
// the catch is intentional.
function migrateAppSchema(db: Database.Database): void {
  const safe = (sql: string) => {
    try {
      db.exec(sql);
    } catch {
      /* column already exists — no-op */
    }
  };
  safe("ALTER TABLE apps ADD COLUMN credential_type TEXT NOT NULL DEFAULT 'secret'");
  safe(
    "ALTER TABLE apps ADD COLUMN browser_direct_enabled INTEGER NOT NULL DEFAULT 1",
  );
}

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

// ---------------------------------------------------------------------------
// Row mappers
// ---------------------------------------------------------------------------

function rowToApp(row: any): AppRow {
  return {
    id: row.id,
    apiKeyHash: row.api_key_hash,
    origin: row.origin,
    name: row.name,
    ownerGithubId: row.owner_github_id,
    ownerEmail: row.owner_email ?? undefined,
    originVerified: row.origin_verified === 1,
    originVerifiedAt: row.origin_verified_at ?? undefined,
    originVerifyToken: row.origin_verify_token,
    rateLimitPerMin: row.rate_limit_per_min,
    dailyRequestCap: row.daily_request_cap,
    revokedAt: row.revoked_at ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    credentialType: row.credential_type as CredentialType,
    browserDirectEnabled: row.browser_direct_enabled === 1,
  };
}

function rowToOrigin(row: any): OriginRow {
  return {
    id: row.id,
    appId: row.app_id,
    origin: row.origin,
    tier: row.tier as OriginTier,
    status: row.status as OriginStatus,
    lastUsedAt: row.last_used_at ?? undefined,
    lastUsedIp: row.last_used_ip ?? undefined,
    createdAt: row.created_at,
  };
}

function rowToPublishableKey(row: any): PublishableKeyRow {
  return {
    id: row.id,
    appId: row.app_id,
    keyHash: row.key_hash,
    label: row.label ?? undefined,
    status: row.status as PublishableKeyStatus,
    createdAt: row.created_at,
    createdBy: row.created_by ?? undefined,
    revokedAt: row.revoked_at ?? undefined,
    revokedBy: row.revoked_by ?? undefined,
    lastUsedAt: row.last_used_at ?? undefined,
    lastUsedIp: row.last_used_ip ?? undefined,
  };
}

// ---------------------------------------------------------------------------
// createStore — the main export for the apps / publishable-key flows
// ---------------------------------------------------------------------------

export function createStore({ url }: { url: string }) {
  const db = new Database(url);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.exec(APP_SCHEMA);
  migrateAppSchema(db);

  return {
    apps: {
      async create(opts: {
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
      }): Promise<AppRow> {
        const now = Date.now();
        const credentialType = opts.credentialType ?? "secret";
        const browserDirectEnabled = opts.browserDirectEnabled ?? true;
        db.prepare(
          `INSERT INTO apps
             (id, api_key_hash, origin, name, owner_github_id, owner_email,
              origin_verify_token, rate_limit_per_min, daily_request_cap,
              created_at, updated_at, credential_type, browser_direct_enabled)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        ).run(
          opts.id,
          opts.apiKeyHash,
          opts.origin,
          opts.name,
          opts.ownerGithubId,
          opts.ownerEmail ?? null,
          opts.originVerifyToken,
          opts.rateLimitPerMin ?? 60,
          opts.dailyRequestCap ?? 10000,
          now,
          now,
          credentialType,
          browserDirectEnabled ? 1 : 0,
        );
        return {
          id: opts.id,
          apiKeyHash: opts.apiKeyHash,
          origin: opts.origin,
          name: opts.name,
          ownerGithubId: opts.ownerGithubId,
          ownerEmail: opts.ownerEmail,
          originVerified: false,
          originVerifyToken: opts.originVerifyToken,
          rateLimitPerMin: opts.rateLimitPerMin ?? 60,
          dailyRequestCap: opts.dailyRequestCap ?? 10000,
          createdAt: now,
          updatedAt: now,
          credentialType,
          browserDirectEnabled,
        };
      },

      async getByApiKeyHash(hash: string): Promise<AppRow | null> {
        const row = db
          .prepare("SELECT * FROM apps WHERE api_key_hash = ?")
          .get(hash) as any;
        return row ? rowToApp(row) : null;
      },

      async getByOrigin(origin: string): Promise<AppRow | null> {
        const row = db
          .prepare("SELECT * FROM apps WHERE origin = ? AND revoked_at IS NULL")
          .get(origin) as any;
        return row ? rowToApp(row) : null;
      },
    },

    origins: {
      async add(opts: {
        appId: string;
        origin: string;
        tier: OriginTier;
      }): Promise<OriginRow> {
        const id = `org_${randomBytes(10).toString("hex")}`;
        const now = Date.now();
        db.prepare(
          `INSERT INTO app_origins (id, app_id, origin, tier, status, created_at)
           VALUES (?, ?, ?, ?, 'active', ?)`,
        ).run(id, opts.appId, opts.origin, opts.tier, now);
        return {
          id,
          appId: opts.appId,
          origin: opts.origin,
          tier: opts.tier,
          status: "active",
          createdAt: now,
        };
      },

      async listForApp(appId: string): Promise<OriginRow[]> {
        const rows = db
          .prepare(
            "SELECT * FROM app_origins WHERE app_id = ? ORDER BY created_at ASC",
          )
          .all(appId) as any[];
        return rows.map(rowToOrigin);
      },

      async getAppByActiveOrigin(origin: string): Promise<AppRow | null> {
        const row = db
          .prepare(
            `SELECT a.* FROM apps a
             INNER JOIN app_origins o ON o.app_id = a.id
             WHERE o.origin = ? AND o.status = 'active' AND a.revoked_at IS NULL`,
          )
          .get(origin) as any;
        return row ? rowToApp(row) : null;
      },

      async setStatus(originId: string, status: OriginStatus): Promise<void> {
        db.prepare("UPDATE app_origins SET status = ? WHERE id = ?").run(
          status,
          originId,
        );
      },

      async remove(originId: string): Promise<void> {
        db.prepare("DELETE FROM app_origins WHERE id = ?").run(originId);
      },

      async recordUsage(originId: string, ip: string): Promise<void> {
        const now = Date.now();
        db.prepare(
          "UPDATE app_origins SET last_used_at = ?, last_used_ip = ? WHERE id = ?",
        ).run(now, ip, originId);
      },
    },

    publishableKeys: {
      async create(opts: {
        appId: string;
        keyHash: string;
        label?: string;
        createdBy?: string;
      }): Promise<PublishableKeyRow> {
        const id = `pk_${randomBytes(10).toString("hex")}`;
        const now = Date.now();
        db.prepare(
          `INSERT INTO app_publishable_keys
             (id, app_id, key_hash, label, status, created_at, created_by)
           VALUES (?, ?, ?, ?, 'active', ?, ?)`,
        ).run(
          id,
          opts.appId,
          opts.keyHash,
          opts.label ?? null,
          now,
          opts.createdBy ?? null,
        );
        return {
          id,
          appId: opts.appId,
          keyHash: opts.keyHash,
          label: opts.label,
          status: "active",
          createdAt: now,
          createdBy: opts.createdBy,
        };
      },

      async listForApp(appId: string): Promise<PublishableKeyRow[]> {
        const rows = db
          .prepare(
            `SELECT * FROM app_publishable_keys
             WHERE app_id = ? ORDER BY created_at DESC`,
          )
          .all(appId) as any[];
        return rows.map(rowToPublishableKey);
      },

      async getActiveByHash(
        hash: string,
      ): Promise<{ app: AppRow; key: PublishableKeyRow } | null> {
        const row = db
          .prepare(
            `SELECT
               a.id AS a_id, a.api_key_hash, a.origin, a.name,
               a.owner_github_id, a.owner_email,
               a.origin_verified, a.origin_verified_at, a.origin_verify_token,
               a.rate_limit_per_min, a.daily_request_cap, a.revoked_at,
               a.created_at AS a_created_at, a.updated_at,
               a.credential_type, a.browser_direct_enabled,
               k.id AS k_id, k.key_hash AS k_key_hash, k.label, k.status,
               k.created_at AS k_created_at, k.created_by,
               k.revoked_at AS k_revoked_at, k.revoked_by,
               k.last_used_at, k.last_used_ip
             FROM app_publishable_keys k
             INNER JOIN apps a ON a.id = k.app_id
             WHERE k.key_hash = ? AND k.status = 'active' AND a.revoked_at IS NULL`,
          )
          .get(hash) as any;
        if (!row) return null;
        const app: AppRow = {
          id: row.a_id,
          apiKeyHash: row.api_key_hash,
          origin: row.origin,
          name: row.name,
          ownerGithubId: row.owner_github_id,
          ownerEmail: row.owner_email ?? undefined,
          originVerified: row.origin_verified === 1,
          originVerifiedAt: row.origin_verified_at ?? undefined,
          originVerifyToken: row.origin_verify_token,
          rateLimitPerMin: row.rate_limit_per_min,
          dailyRequestCap: row.daily_request_cap,
          revokedAt: row.revoked_at ?? undefined,
          createdAt: row.a_created_at,
          updatedAt: row.updated_at,
          credentialType: row.credential_type as CredentialType,
          browserDirectEnabled: row.browser_direct_enabled === 1,
        };
        const key: PublishableKeyRow = {
          id: row.k_id,
          appId: row.a_id,
          keyHash: row.k_key_hash,
          label: row.label ?? undefined,
          status: row.status as PublishableKeyStatus,
          createdAt: row.k_created_at,
          createdBy: row.created_by ?? undefined,
          revokedAt: row.k_revoked_at ?? undefined,
          revokedBy: row.revoked_by ?? undefined,
          lastUsedAt: row.last_used_at ?? undefined,
          lastUsedIp: row.last_used_ip ?? undefined,
        };
        return { app, key };
      },

      async revoke(keyId: string, actorGhId: string): Promise<void> {
        const now = Date.now();
        db.prepare(
          `UPDATE app_publishable_keys
           SET status = 'revoked', revoked_at = ?, revoked_by = ?
           WHERE id = ? AND status = 'active'`,
        ).run(now, actorGhId, keyId);
      },

      async recordUsage(keyId: string, ip: string): Promise<void> {
        const now = Date.now();
        db.prepare(
          "UPDATE app_publishable_keys SET last_used_at = ?, last_used_ip = ? WHERE id = ?",
        ).run(now, ip, keyId);
      },
    },
  };
}
