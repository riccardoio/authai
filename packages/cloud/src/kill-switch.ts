/**
 * Global cost-cap kill switch + per-app sliding-window rate limiter.
 *
 * Both depend on a small Redis-shaped interface — pluggable so the deploy
 * app can wire it to Upstash, ioredis, or an in-memory mock for tests.
 *
 * Design (per the eng review, decision A2):
 *
 *   - Redis-unreachable behavior is FAIL-OPEN + emit an alert event.
 *     The cost cap is best-effort; a Redis blip should not take down the
 *     cloud relay. The real backstop is the operator responding to the
 *     alert webhook.
 *
 *   - States (the three the eng review collapsed to):
 *       healthy       — normal traffic
 *       paused-new    — existing JWTs still work, /auth/start returns 503
 *       read-only     — /v1/* blocked with structured 503, /auth/whoami
 *                       and /auth/revoke continue
 *
 *   - Re-enable: an OPERATOR_SECRET-gated CLI sets state back to healthy.
 *     Deliberately NOT exposed via the admin API so a leaked admin JWT
 *     cannot bypass the cap.
 */

export type KillSwitchState = "healthy" | "paused-new" | "read-only";

export interface RedisLike {
  /** Atomic increment by `by`, returning the new value. */
  incrby(key: string, by: number): Promise<number>;
  /**
   * Set TTL on a key in seconds. Returns 1 if the timeout was set, 0 if
   * the key didn't exist (matches the underlying Redis EXPIRE protocol
   * — ioredis surfaces it as `Promise<number>`, an in-memory mock can
   * return any number).
   */
  expire(key: string, seconds: number): Promise<number | unknown>;
  /** Get raw string value or null. */
  get(key: string): Promise<string | null>;
  /** Set value (string). Returns OK on success. */
  set(key: string, value: string): Promise<string | unknown>;
}

export type KillSwitchConfig = {
  redis: RedisLike;
  /**
   * Daily request count above which the relay transitions away from
   * `healthy`. Reset at midnight UTC by virtue of the daily key naming.
   */
  dailyRequestCap: number;
  /**
   * Soft threshold (fraction of cap). When daily requests cross this,
   * the relay transitions to `paused-new` automatically. Default 0.8 (80%).
   */
  softThresholdFraction?: number;
  /**
   * Called when the kill switch transitions state OR when Redis becomes
   * unreachable. The deploy app can wire this to an email/webhook so the
   * operator gets paged. Errors thrown by the callback are swallowed (we
   * don't want a broken alert path to take down the relay).
   */
  onStateChange?: (event: KillSwitchEvent) => void;
};

export type KillSwitchEvent =
  | { type: "state_transition"; from: KillSwitchState; to: KillSwitchState; reason: string }
  | { type: "redis_unreachable"; error: string };

export interface KillSwitch {
  /** Current state, observed from Redis (cached briefly to avoid hammering). */
  currentState(): Promise<KillSwitchState>;
  /**
   * Record a request against the daily counter and re-evaluate state.
   * Returns the state AS OF this call so the caller can short-circuit
   * the request immediately if needed.
   */
  recordRequest(): Promise<KillSwitchState>;
  /** Operator-driven override. Caller must have already proven OPERATOR_SECRET. */
  setState(state: KillSwitchState, reason: string): Promise<void>;
}

const STATE_KEY = "authai:cloud:kill-switch:state";

export function createKillSwitch(config: KillSwitchConfig): KillSwitch {
  const softThreshold = Math.floor(
    config.dailyRequestCap * (config.softThresholdFraction ?? 0.8),
  );

  // Brief in-process cache so a single request doesn't always read Redis
  // twice (once via currentState, once via recordRequest). 5s is small
  // enough to not significantly delay operator overrides.
  let stateCache: { value: KillSwitchState; expiresAt: number } | null = null;

  async function readState(): Promise<KillSwitchState> {
    const now = Date.now();
    if (stateCache && stateCache.expiresAt > now) return stateCache.value;
    try {
      const raw = await config.redis.get(STATE_KEY);
      const state = parseState(raw) ?? "healthy";
      stateCache = { value: state, expiresAt: now + 5_000 };
      return state;
    } catch (err) {
      emit({ type: "redis_unreachable", error: (err as Error).message });
      return "healthy"; // FAIL-OPEN per A2.
    }
  }

  function emit(event: KillSwitchEvent) {
    try {
      config.onStateChange?.(event);
    } catch {
      // Alert path must not take down the relay.
    }
  }

  return {
    async currentState() {
      return readState();
    },

    async recordRequest() {
      const today = dailyKey();
      let count: number;
      try {
        count = await config.redis.incrby(today, 1);
        // 25h TTL — covers clock skew between Redis and relay, key rolls
        // over naturally at midnight UTC.
        await config.redis.expire(today, 25 * 3600);
      } catch (err) {
        emit({ type: "redis_unreachable", error: (err as Error).message });
        return "healthy"; // FAIL-OPEN.
      }

      const previous = await readState();
      let next: KillSwitchState = previous;
      if (count >= config.dailyRequestCap) {
        next = "paused-new";
      } else if (count >= softThreshold && previous === "healthy") {
        next = "paused-new";
      }
      if (next !== previous) {
        try {
          await config.redis.set(STATE_KEY, next);
        } catch {
          /* fail-open */
        }
        stateCache = { value: next, expiresAt: Date.now() + 5_000 };
        emit({
          type: "state_transition",
          from: previous,
          to: next,
          reason: `daily count ${count} crossed threshold`,
        });
      }
      return next;
    },

    async setState(state, reason) {
      const previous = await readState();
      try {
        await config.redis.set(STATE_KEY, state);
      } catch (err) {
        emit({ type: "redis_unreachable", error: (err as Error).message });
        throw new Error("cannot persist state: redis unreachable");
      }
      stateCache = { value: state, expiresAt: Date.now() + 5_000 };
      emit({
        type: "state_transition",
        from: previous,
        to: state,
        reason: `operator override: ${reason}`,
      });
    },
  };
}

function parseState(raw: string | null): KillSwitchState | null {
  if (raw === "healthy" || raw === "paused-new" || raw === "read-only") return raw;
  return null;
}

function dailyKey(): string {
  const d = new Date();
  return `authai:cloud:kill-switch:daily:${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

function pad(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

// ---------------------------------------------------------------------------
// Per-app sliding-window rate limiter
// ---------------------------------------------------------------------------

export type RateLimiterConfig = {
  redis: RedisLike;
  /** Window size in seconds for the sliding-window counter. Default 60. */
  windowSeconds?: number;
  /** Called when Redis is unreachable. Fail-open per A2. */
  onUnreachable?: (error: string) => void;
};

export type RateLimitDecision =
  | { allowed: true; remaining: number }
  | { allowed: false; retryAfterSeconds: number };

export interface RateLimiter {
  /**
   * Probe + increment for a request. Returns whether the request fits
   * within `limit` for the current window.
   */
  check(appId: string, limit: number): Promise<RateLimitDecision>;
}

export function createRateLimiter(config: RateLimiterConfig): RateLimiter {
  const windowSec = config.windowSeconds ?? 60;
  return {
    async check(appId, limit) {
      const bucket = Math.floor(Date.now() / 1000 / windowSec);
      const key = `authai:cloud:ratelimit:${appId}:${bucket}`;
      let count: number;
      try {
        count = await config.redis.incrby(key, 1);
        // TTL slightly beyond the window so we never store unbounded keys.
        if (count === 1) await config.redis.expire(key, windowSec * 2);
      } catch (err) {
        config.onUnreachable?.((err as Error).message);
        return { allowed: true, remaining: limit }; // FAIL-OPEN per A2.
      }
      if (count > limit) {
        // The TTL gives us a generous retryAfter — within a window the user
        // may still be served by the next bucket sooner, but a conservative
        // hint protects upstream providers from thundering retries.
        const elapsed = (Date.now() / 1000) % windowSec;
        const retryAfter = Math.ceil(windowSec - elapsed);
        return { allowed: false, retryAfterSeconds: retryAfter };
      }
      return { allowed: true, remaining: limit - count };
    },
  };
}
