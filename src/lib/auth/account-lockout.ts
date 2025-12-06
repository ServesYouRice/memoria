/**
 * Account Lockout Service
 *
 * Implements account lockout after failed login attempts.
 * Uses Redis if available, falls back to in-memory store.
 *
 * @module lib/auth/account-lockout
 */

import { logger } from '@/lib/logger';

// In-memory fallback for lockout tracking
const lockoutStore = new Map<string, { attempts: number; lockedUntil?: number }>();

// Configuration
const LOCKOUT_THRESHOLD = 5; // Lock after 5 failed attempts
const LOCKOUT_DURATION_MS = 15 * 60 * 1000; // 15 minutes
const ATTEMPT_WINDOW_MS = 60 * 60 * 1000; // 1 hour window for attempts

// Redis client (optional)
let redis: any = null;

async function getRedis() {
    if (redis) return redis;

    const redisUrl = process.env.REDIS_URL;
    if (!redisUrl) return null;

    try {
        const Redis = (await import('ioredis')).default;
        redis = new Redis(redisUrl, { maxRetriesPerRequest: 3, lazyConnect: true });
        return redis;
    } catch (error) {
        logger.warn({ error }, 'Redis not available for lockout, using in-memory');
        return null;
    }
}

/**
 * Check if an account is locked out
 */
export async function isAccountLocked(email: string): Promise<boolean> {
    const client = await getRedis();
    const key = `lockout:${email.toLowerCase()}`;

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
            logger.warn({ error, email }, 'Failed to check lockout in Redis');
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
    const client = await getRedis();
    const key = `lockout:${email.toLowerCase()}`;

    let lockedUntil: number | undefined;

    if (client) {
        try {
            const lockData = await client.get(key);
            if (lockData) {
                lockedUntil = JSON.parse(lockData).lockedUntil;
            }
        } catch (error) {
            logger.warn({ error, email }, 'Failed to get lockout remaining');
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
export async function recordFailedAttempt(email: string): Promise<{ locked: boolean; attempts: number }> {
    const client = await getRedis();
    const key = `lockout:${email.toLowerCase()}`;

    let attempts = 1;
    let locked = false;

    if (client) {
        try {
            const lockData = await client.get(key);
            if (lockData) {
                const data = JSON.parse(lockData);
                attempts = (data.attempts || 0) + 1;
            }

            const newData: { attempts: number; lockedUntil?: number } = { attempts };

            if (attempts >= LOCKOUT_THRESHOLD) {
                newData.lockedUntil = Date.now() + LOCKOUT_DURATION_MS;
                locked = true;
                logger.warn({ email, attempts }, 'Account locked due to failed attempts');
            }

            await client.setex(key, Math.ceil(ATTEMPT_WINDOW_MS / 1000), JSON.stringify(newData));
        } catch (error) {
            logger.warn({ error, email }, 'Failed to record attempt in Redis');
        }
    } else {
        // Fallback to in-memory
        const data = lockoutStore.get(key) || { attempts: 0 };
        attempts = data.attempts + 1;

        const newData: { attempts: number; lockedUntil?: number } = { attempts };

        if (attempts >= LOCKOUT_THRESHOLD) {
            newData.lockedUntil = Date.now() + LOCKOUT_DURATION_MS;
            locked = true;
            logger.warn({ email, attempts }, 'Account locked due to failed attempts');
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
    const client = await getRedis();
    const key = `lockout:${email.toLowerCase()}`;

    if (client) {
        try {
            await client.del(key);
        } catch (error) {
            logger.warn({ error, email }, 'Failed to clear lockout in Redis');
        }
    }

    lockoutStore.delete(key);
}
