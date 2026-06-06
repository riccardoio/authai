import Database from "better-sqlite3";
import type { AuthRecord, AuthRecordStore } from "@authai/relay";

type Row = {
  id: string;
  iv: Buffer;
  blob: Buffer;
  account_id_hash: string;
  created_at: number;
  updated_at: number;
  expires_at: number;
};

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
CREATE INDEX IF NOT EXISTS auth_records_by_account ON auth_records (account_id_hash);
CREATE INDEX IF NOT EXISTS auth_records_by_expires ON auth_records (expires_at);
`;

export function createSqliteStore(path: string): AuthRecordStore {
  const db = new Database(path);
  db.pragma("journal_mode = WAL");
  db.exec(SCHEMA);

  const put = db.prepare<[string, Buffer, Buffer, string, number, number, number]>(
    `INSERT INTO auth_records (id, iv, blob, account_id_hash, created_at, updated_at, expires_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       iv = excluded.iv,
       blob = excluded.blob,
       account_id_hash = excluded.account_id_hash,
       updated_at = excluded.updated_at,
       expires_at = excluded.expires_at`,
  );
  const getById = db.prepare<[string], Row>(`SELECT * FROM auth_records WHERE id = ?`);
  const findHash = db.prepare<[string], Row>(
    `SELECT * FROM auth_records WHERE account_id_hash = ? ORDER BY updated_at DESC LIMIT 1`,
  );
  const updateStmt = db.prepare<[Buffer, Buffer, number, number, string]>(
    `UPDATE auth_records SET iv = ?, blob = ?, updated_at = ?, expires_at = ? WHERE id = ?`,
  );
  const updateBlobOnly = db.prepare<[Buffer, Buffer, number, string]>(
    `UPDATE auth_records SET iv = ?, blob = ?, updated_at = ? WHERE id = ?`,
  );
  const deleteStmt = db.prepare<[string]>(`DELETE FROM auth_records WHERE id = ?`);
  const sweep = db.prepare<[number]>(`DELETE FROM auth_records WHERE expires_at < ?`);

  return {
    async put(r) {
      put.run(
        r.id,
        Buffer.from(r.iv),
        Buffer.from(r.blob),
        r.accountIdHash,
        r.createdAt,
        r.updatedAt,
        r.expiresAt,
      );
    },
    async get(id) {
      const row = getById.get(id);
      return row ? rowToRecord(row) : null;
    },
    async findByAccountHash(hash) {
      const row = findHash.get(hash);
      return row ? rowToRecord(row) : null;
    },
    async update(id, patch) {
      const iv = patch.iv ? Buffer.from(patch.iv) : null;
      const blob = patch.blob ? Buffer.from(patch.blob) : null;
      const updatedAt = patch.updatedAt ?? Date.now();
      if (iv && blob && patch.expiresAt !== undefined) {
        updateStmt.run(iv, blob, updatedAt, patch.expiresAt, id);
      } else if (iv && blob) {
        updateBlobOnly.run(iv, blob, updatedAt, id);
      }
    },
    async delete(id) {
      deleteStmt.run(id);
    },
    async sweepExpired(now) {
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
