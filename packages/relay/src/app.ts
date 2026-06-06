import { Hono } from "hono";
import { createAuthRoutes } from "./auth-routes.js";
import { createV1Routes } from "./v1-routes.js";
import type { AuthRecordStore } from "./store.js";

export type RelayConfig = {
  store: AuthRecordStore;
  jwtSecret: Uint8Array;
  originator: string;
};

export function createRelayApp(config: RelayConfig): Hono {
  const app = new Hono();

  app.use("*", async (c, next) => {
    c.header("Access-Control-Allow-Origin", "*");
    c.header("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    c.header("Access-Control-Allow-Headers", "Content-Type, Authorization");
    c.header("Access-Control-Max-Age", "86400");
    if (c.req.method === "OPTIONS") {
      return c.body(null, 204);
    }
    await next();
  });

  app.get("/", (c) => c.json({ ok: true, service: "authai-relay" }));

  app.route("/auth", createAuthRoutes({
    store: config.store,
    jwtSecret: config.jwtSecret,
    originator: config.originator,
  }));

  app.route("/v1", createV1Routes({
    store: config.store,
    jwtSecret: config.jwtSecret,
  }));

  return app;
}

export function startBackgroundSweep(store: AuthRecordStore, intervalMs = 5 * 60 * 1000): { stop: () => void } {
  const timer = setInterval(() => {
    store.sweepExpired(Date.now()).catch(() => { /* ignore sweep errors */ });
  }, intervalMs);
  timer.unref();
  return { stop: () => clearInterval(timer) };
}
