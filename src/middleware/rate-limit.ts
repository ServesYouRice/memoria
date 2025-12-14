import { NextRequest, NextResponse } from 'next/server';
import { createLogger } from '@/lib/logger';
import {
  API_RATE_LIMIT_WINDOW_MS,
  API_RATE_LIMIT_MAX_REQUESTS,
  AUTH_RATE_LIMIT_WINDOW_MS,
  AUTH_RATE_LIMIT_MAX_REQUESTS,
} from '@/lib/constants';

const logger = createLogger('rate-limit');

// Redis client (lazy loaded)
let redis: any = null;

async function getRedis() {
  if (redis) return redis;

  // Check for standard Redis URL or Upstash Redis URL
  const redisUrl = process.env['REDIS_URL'] || process.env['UPSTASH_REDIS_REST_URL'];

  if (!redisUrl) return null;

  try {
    // Dynamically import ioredis to avoid bundling issues if not used
    const Redis = (await import('ioredis')).default;
    redis = new Redis(redisUrl, {
      maxRetriesPerRequest: 1,
      connectTimeout: 2000,
      lazyConnect: true
    });

    // Handle error events to prevent crashing
    redis.on('error', (err: any) => {
      logger.warn({ err }, 'Redis rate limit error');
    });

    return redis;
  } catch (error) {
    logger.warn({ error }, 'Failed to initialize Redis for rate limiting');
    return null;
  }
}

// In-memory store for development/fallback
interface RateLimitEntry {
  count: number;
  resetAt: number;
}

const rateLimitStore = new Map<string, RateLimitEntry>();

function cleanupExpiredEntries(): void {
  const now = Date.now();
  const keysToDelete: string[] = [];

  for (const [key, entry] of rateLimitStore.entries()) {
    if (entry.resetAt < now) {
      keysToDelete.push(key);
    }
  }

  keysToDelete.forEach(key => rateLimitStore.delete(key));
}

export interface RateLimitConfig {
  maxRequests: number;
  windowMs: number;
  keyPrefix?: string;
}

/**
 * Rate limiting middleware with Redis support
 */
export function rateLimit(config: RateLimitConfig) {
  const { maxRequests, windowMs, keyPrefix = 'rl' } = config;

  return async function checkRateLimit(request: NextRequest): Promise<NextResponse | null> {
    const identifier =
      request.headers.get('x-forwarded-for') || request.headers.get('x-real-ip') || 'unknown';

    const key = `${keyPrefix}:${identifier}`;
    const now = Date.now();

    try {
      const client = await getRedis();

      if (client) {
        // Redis implementation (sliding window approximated with fixed window + expiration)

        // Use a transaction
        const multi = client.multi();
        multi.incr(key);
        multi.pttl(key);
        const results = await multi.exec();

        if (!results) throw new Error('Redis transaction failed');

        const [incrErr, currentCount] = results[0];
        const [, ttl] = results[1];

        if (incrErr) throw incrErr;

        // If new key (ttl is -1 or similar depending on redis version/client), set expiration
        if (typeof ttl === 'number' && ttl < 0) {
          await client.pexpire(key, windowMs);
        }

        const count = Number(currentCount);

        if (count > maxRequests) {
          logger.warn({ identifier, key, count }, 'Rate limit exceeded (Redis)');
          return NextResponse.json(
            {
              error: 'Too many requests',
              retryAfter: Math.ceil(windowMs / 1000),
            },
            {
              status: 429,
              headers: {
                'X-RateLimit-Limit': maxRequests.toString(),
                'X-RateLimit-Remaining': '0',
                'X-RateLimit-Reset': (now + windowMs).toString()
              }
            }
          );
        }

        return null;
      }
    } catch (error) {
      // Fallback to in-memory if Redis fails
      logger.warn({ error }, 'Rate limit Redis error, falling back to in-memory');
    }

    // In-memory implementation (Fallback)
    cleanupExpiredEntries();

    let entry = rateLimitStore.get(key);

    if (!entry || entry.resetAt < now) {
      entry = {
        count: 1,
        resetAt: now + windowMs,
      };
      rateLimitStore.set(key, entry);
      return null;
    }

    if (entry.count >= maxRequests) {
      logger.warn({ identifier, key }, 'Rate limit exceeded (Memory)');
      return NextResponse.json(
        {
          error: 'Too many requests',
          retryAfter: Math.ceil((entry.resetAt - now) / 1000),
        },
        { status: 429 }
      );
    }

    entry.count++;
    return null;
  };
}

/**
 * Endpoint-specific rate limits
 */
export const authRateLimit = rateLimit({
  maxRequests: AUTH_RATE_LIMIT_MAX_REQUESTS,
  windowMs: AUTH_RATE_LIMIT_WINDOW_MS,
  keyPrefix: 'auth',
});

export const apiRateLimit = rateLimit({
  maxRequests: API_RATE_LIMIT_MAX_REQUESTS,
  windowMs: API_RATE_LIMIT_WINDOW_MS,
  keyPrefix: 'api',
});

export const uploadRateLimit = rateLimit({
  maxRequests: 10, // 10 uploads per hour
  windowMs: 60 * 60 * 1000,
  keyPrefix: 'upload',
});

export const canvasesRateLimit = rateLimit({
  maxRequests: 50,
  windowMs: 60 * 1000,
  keyPrefix: 'canvases',
});

export const itemsRateLimit = rateLimit({
  maxRequests: 200,
  windowMs: 60 * 1000,
  keyPrefix: 'items',
});
