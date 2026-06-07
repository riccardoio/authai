/**
 * Lazily-constructed Postgres store, shared across server actions and API
 * routes. Long-lived processes keep the pool warm; cold starts (e.g.,
 * after a deploy + first request) reconstruct cheaply.
 */

import { createPostgresStore, type PostgresStore } from "@authai/relay-store-postgres";
import { requiredFromAny } from "./env";

let cached: PostgresStore | null = null;

export async function getStore(): Promise<PostgresStore> {
  if (cached) return cached;
  // Accept either AUTH_AI_DATABASE_URL or DATABASE_URL — Dokku's
  // postgres:link sets DATABASE_URL automatically and rotates it on
  // credential changes; we read it directly so we don't need to mirror
  // the value into AUTH_AI_DATABASE_URL after every link or rotation.
  const url = requiredFromAny(["AUTH_AI_DATABASE_URL", "DATABASE_URL"]);
  cached = await createPostgresStore({ connectionString: url });
  return cached;
}
