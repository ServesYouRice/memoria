import { getRedisClient } from "@/lib/cache/redis-client";
import { createLogger } from "@/lib/logger";

const logger = createLogger("account-lockout");

const lockoutStore = new Map<
  string,
  { attempts: number; lockedUntil?: number }
>();
const LOCKOUT_THRESHOLD = 5;
const LOCKOUT_DURATION_MS = 15 * 60 * 1000;
const ATTEMPT_WINDOW_MS = 60 * 60 * 1000;

function getLockoutKey(email: string) {
  return `auth:lockout:${email.trim().toLowerCase()}`;
}

/**
 * Check if an account is locked out
 */
export async function isAccountLocked(email: string): Promise<boolean> {
  const client = getRedisClient();
  const key = getLockoutKey(email);

  if (client) {
    try {
      const lockData = await client.get(key);
      if (lockData) {
        const { lockedUntil } = JSON.parse(lockData);
        if (lockedUntil && Date.now() < lockedUntil) {
          return true;
        }
      }
      return false;
    } catch (error) {
      logger.warn({ error, email }, "Failed to check lockout in Redis");
    }
  }

  // Fallback to in-memory
  const data = lockoutStore.get(key);
  if (data?.lockedUntil && Date.now() < data.lockedUntil) {
    return true;
  }
  return false;
}

/**
 * Get remaining lockout time in seconds
 */
export async function getLockoutRemaining(email: string): Promise<number> {
  const client = getRedisClient();
  const key = getLockoutKey(email);

  let lockedUntil: number | undefined;

  if (client) {
    try {
      const lockData = await client.get(key);
      if (lockData) {
        lockedUntil = JSON.parse(lockData).lockedUntil;
      }
    } catch (error) {
      logger.warn({ error, email }, "Failed to get lockout remaining");
    }
  } else {
    lockedUntil = lockoutStore.get(key)?.lockedUntil;
  }

  if (lockedUntil && Date.now() < lockedUntil) {
    return Math.ceil((lockedUntil - Date.now()) / 1000);
  }
  return 0;
}

/**
 * Record a failed login attempt
 */
export async function recordFailedAttempt(
  email: string,
): Promise<{ locked: boolean; attempts: number }> {
  const client = getRedisClient();
  const key = getLockoutKey(email);

  let attempts = 1;
  let locked = false;

  if (client) {
    try {
      const [nextAttempts, lockedUntil] = (await client.eval(
        `
          local attempts = 0
          local existingLockedUntil = 0
          local raw = redis.call("GET", KEYS[1])
          if raw then
            local ok, data = pcall(cjson.decode, raw)
            if ok and data then
              attempts = tonumber(data.attempts) or 0
              existingLockedUntil = tonumber(data.lockedUntil) or 0
            end
          end

          local now = tonumber(ARGV[1])
          if existingLockedUntil > now then
            return {attempts, existingLockedUntil}
          end

          attempts = attempts + 1
          local lockedUntil = 0
          if attempts >= tonumber(ARGV[2]) then
            lockedUntil = now + tonumber(ARGV[3])
          end

          local data = {attempts = attempts}
          if lockedUntil > 0 then data.lockedUntil = lockedUntil end
          redis.call("SETEX", KEYS[1], ARGV[4], cjson.encode(data))
          return {attempts, lockedUntil}
        `,
        1,
        key,
        Date.now(),
        LOCKOUT_THRESHOLD,
        LOCKOUT_DURATION_MS,
        Math.ceil(ATTEMPT_WINDOW_MS / 1000),
      )) as [number, number];

      attempts = nextAttempts;
      locked = lockedUntil > Date.now();
      if (locked) {
        logger.warn(
          { email, attempts },
          "Account locked due to failed attempts",
        );
      }
    } catch (error) {
      logger.warn({ error, email }, "Failed to record attempt in Redis");
    }
  } else {
    // Fallback to in-memory
    const data = lockoutStore.get(key) || { attempts: 0 };
    attempts = data.attempts + 1;

    const newData: { attempts: number; lockedUntil?: number } = { attempts };

    if (attempts >= LOCKOUT_THRESHOLD) {
      newData.lockedUntil = Date.now() + LOCKOUT_DURATION_MS;
      locked = true;
      logger.warn({ email, attempts }, "Account locked due to failed attempts");
    }

    lockoutStore.set(key, newData);

    // Cleanup in-memory store after window
    setTimeout(() => lockoutStore.delete(key), ATTEMPT_WINDOW_MS);
  }

  return { locked, attempts };
}

/**
 * Clear failed attempts (call after successful login)
 */
export async function clearFailedAttempts(email: string): Promise<void> {
  const client = getRedisClient();
  const key = getLockoutKey(email);

  if (client) {
    try {
      await client.del(key);
    } catch (error) {
      logger.warn({ error, email }, "Failed to clear lockout in Redis");
    }
  }

  lockoutStore.delete(key);
}
