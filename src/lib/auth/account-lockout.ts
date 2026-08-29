import { createHash } from "crypto";
import { getRedisClient } from "@/lib/cache/redis-client";
import { createLogger } from "@/lib/logger";
import { incrementOperationalCounter } from "@/lib/operations/runtime-metrics";

const logger = createLogger("account-lockout");
const LOCKOUT_THRESHOLD = 5;
const LOCKOUT_DURATION_MS = 15 * 60 * 1000;
const ATTEMPT_WINDOW_MS = 60 * 60 * 1000;
const MAX_ACCOUNT_DELAY_MS = 2_000;
type AttemptState = {
  attempts: number;
  lockedUntil?: number;
  expiresAt: number;
};
const pairStore = new Map<string, AttemptState>();
const accountStore = new Map<string, AttemptState>();

export class LockoutStoreUnavailableError extends Error {
  constructor() {
    super("Login safety service is temporarily unavailable");
    this.name = "LockoutStoreUnavailableError";
  }
}

function principal(email: string) {
  return email.trim().toLowerCase();
}

function digest(value: string) {
  return createHash("sha256").update(value).digest("hex").slice(0, 32);
}

function keys(email: string, clientId: string) {
  const account = `auth:attempts:account:${digest(principal(email))}`;
  return {
    account,
    pair: `${account}:client:${digest(clientId || "unknown")}`,
  };
}

function redisFailure(error: unknown, operation: string): never | void {
  incrementOperationalCounter("redis_safety_failures_total");
  logger.warn({ error, operation }, "Login attempt store unavailable");
  if (process.env.NODE_ENV === "production") {
    throw new LockoutStoreUnavailableError();
  }
}

function liveState(store: Map<string, AttemptState>, key: string) {
  const state = store.get(key);
  if (state && state.expiresAt <= Date.now()) {
    store.delete(key);
    return undefined;
  }
  return state;
}

export async function getLoginDelay(email: string): Promise<number> {
  const { account } = keys(email, "account");
  const client = getRedisClient();
  if (client) {
    try {
      const attempts = Number((await client.get(account)) || 0);
      return Math.min(MAX_ACCOUNT_DELAY_MS, attempts * 100);
    } catch (error) {
      redisFailure(error, "read account delay");
    }
  }
  return Math.min(
    MAX_ACCOUNT_DELAY_MS,
    (liveState(accountStore, account)?.attempts || 0) * 100,
  );
}

export async function isAccountLocked(
  email: string,
  clientId: string,
): Promise<boolean> {
  const { pair } = keys(email, clientId);
  const client = getRedisClient();
  if (client) {
    try {
      const raw = await client.get(pair);
      if (!raw) return false;
      const state = JSON.parse(raw) as AttemptState;
      return Boolean(state.lockedUntil && state.lockedUntil > Date.now());
    } catch (error) {
      redisFailure(error, "read client lockout");
    }
  }
  const state = liveState(pairStore, pair);
  return Boolean(state?.lockedUntil && state.lockedUntil > Date.now());
}

export async function recordFailedAttempt(email: string, clientId: string) {
  const { pair, account } = keys(email, clientId);
  const client = getRedisClient();
  if (client) {
    try {
      const result = (await client.eval(
        `
          local raw = redis.call('GET', KEYS[1])
          local attempts = 0
          if raw then
            local ok, state = pcall(cjson.decode, raw)
            if ok and state then attempts = tonumber(state.attempts) or 0 end
          end
          attempts = attempts + 1
          local lockedUntil = 0
          if attempts >= tonumber(ARGV[2]) then lockedUntil = tonumber(ARGV[1]) + tonumber(ARGV[3]) end
          redis.call('SETEX', KEYS[1], ARGV[4], cjson.encode({attempts=attempts, lockedUntil=lockedUntil}))
          local accountAttempts = redis.call('INCR', KEYS[2])
          if accountAttempts == 1 then redis.call('EXPIRE', KEYS[2], ARGV[4]) end
          return {attempts, lockedUntil, accountAttempts}
        `,
        2,
        pair,
        account,
        Date.now(),
        LOCKOUT_THRESHOLD,
        LOCKOUT_DURATION_MS,
        Math.ceil(ATTEMPT_WINDOW_MS / 1000),
      )) as [number, number, number];
      return {
        attempts: result[0],
        locked: result[1] > Date.now(),
        delayMs: Math.min(MAX_ACCOUNT_DELAY_MS, result[2] * 100),
      };
    } catch (error) {
      redisFailure(error, "record failed attempt");
    }
  }

  const now = Date.now();
  const previous = liveState(pairStore, pair);
  const attempts = (previous?.attempts || 0) + 1;
  const lockedUntil =
    attempts >= LOCKOUT_THRESHOLD ? now + LOCKOUT_DURATION_MS : undefined;
  pairStore.set(pair, {
    attempts,
    lockedUntil,
    expiresAt: now + ATTEMPT_WINDOW_MS,
  });
  const accountAttempts = (liveState(accountStore, account)?.attempts || 0) + 1;
  accountStore.set(account, {
    attempts: accountAttempts,
    expiresAt: now + ATTEMPT_WINDOW_MS,
  });
  return {
    attempts,
    locked: Boolean(lockedUntil),
    delayMs: Math.min(MAX_ACCOUNT_DELAY_MS, accountAttempts * 100),
  };
}

export async function clearFailedAttempts(
  email: string,
  clientId: string,
): Promise<void> {
  const { pair, account } = keys(email, clientId);
  const client = getRedisClient();
  if (client) {
    try {
      await client.del(pair, account);
    } catch (error) {
      redisFailure(error, "clear failed attempts");
    }
  }
  pairStore.delete(pair);
  accountStore.delete(account);
}

export function resetInMemoryLockoutForTests() {
  pairStore.clear();
  accountStore.clear();
}
