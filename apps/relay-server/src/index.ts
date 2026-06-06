import { serve } from "@hono/node-server";
import { createRelayApp, startBackgroundSweep } from "@authai/relay";
import { createSqliteStore } from "@authai/relay-store-sqlite";

function required(name: string): string {
  const value = process.env[name];
  if (!value || value.length === 0) {
    console.error(`Missing required env var: ${name}`);
    process.exit(1);
  }
  return value;
}

const jwtSecretHex = required("AUTH_AI_JWT_SECRET");
const originator = required("AUTH_AI_ORIGINATOR");
const driver = process.env.AUTH_AI_DB_DRIVER ?? "sqlite";
const dbUrl = process.env.AUTH_AI_DB_URL ?? "./relay.db";
const port = Number(process.env.AUTH_AI_PORT ?? 3000);

if (driver !== "sqlite") {
  console.error(`Unsupported AUTH_AI_DB_DRIVER: ${driver}. Only "sqlite" is implemented in v2.`);
  process.exit(1);
}

const store = createSqliteStore(dbUrl);
const jwtSecret = new Uint8Array(Buffer.from(jwtSecretHex, "hex"));
if (jwtSecret.length < 32) {
  console.error("AUTH_AI_JWT_SECRET must decode to at least 32 bytes (use `openssl rand -hex 32`).");
  process.exit(1);
}

const app = createRelayApp({ store, jwtSecret, originator });
startBackgroundSweep(store);

serve({ fetch: app.fetch, port }, (info) => {
  console.log(`AuthAI relay listening on http://localhost:${info.port}`);
  console.log(`  originator=${originator}  driver=${driver}  db=${dbUrl}`);
});
