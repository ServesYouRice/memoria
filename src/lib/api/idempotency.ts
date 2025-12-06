/**
 * Idempotency Key Middleware
 *
 * Provides idempotency support for mutation endpoints to prevent
 * duplicate operations from duplicate requests.
 *
 * @module lib/api/idempotency
 */

import { NextRequest, NextResponse } from 'next/server';
import { logger } from '@/lib/logger';

// In-memory cache for idempotency (use Redis in production)
const idempotencyCache = new Map<string, { response: string; timestamp: number }>();

// Cache TTL: 24 hours
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

// Cleanup interval: 1 hour
const CLEANUP_INTERVAL_MS = 60 * 60 * 1000;

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
        logger.warn({ error }, 'Redis not available for idempotency, using in-memory');
        return null;
    }
}

/**
 * Check if a request has already been processed
 */
export async function getIdempotentResponse(key: string): Promise<string | null> {
    const client = await getRedis();

    if (client) {
        try {
            const cached = await client.get(`idempotency:${key}`);
            if (cached) {
                logger.debug({ key }, 'Idempotency cache hit');
                return cached;
            }
        } catch (error) {
            logger.warn({ error, key }, 'Failed to check idempotency in Redis');
        }
        return null;
    }

    // Fallback to in-memory
    const entry = idempotencyCache.get(key);
    if (entry && Date.now() - entry.timestamp < CACHE_TTL_MS) {
        logger.debug({ key }, 'Idempotency cache hit (in-memory)');
        return entry.response;
    }

    return null;
}

/**
 * Store a response for idempotency
 */
export async function setIdempotentResponse(key: string, response: string): Promise<void> {
    const client = await getRedis();

    if (client) {
        try {
            await client.setex(`idempotency:${key}`, Math.ceil(CACHE_TTL_MS / 1000), response);
            logger.debug({ key }, 'Idempotency response cached');
        } catch (error) {
            logger.warn({ error, key }, 'Failed to set idempotency in Redis');
        }
        return;
    }

    // Fallback to in-memory
    idempotencyCache.set(key, { response, timestamp: Date.now() });
}

/**
 * Extract idempotency key from request headers
 */
export function getIdempotencyKey(request: NextRequest): string | null {
    return request.headers.get('X-Idempotency-Key') || request.headers.get('Idempotency-Key');
}

/**
 * Wrap a handler with idempotency support
 */
export function withIdempotency<T>(
    handler: (req: NextRequest) => Promise<NextResponse<T>>
): (req: NextRequest) => Promise<NextResponse<T>> {
    return async (req: NextRequest) => {
        const idempotencyKey = getIdempotencyKey(req);

        // Only apply to mutation methods
        if (!idempotencyKey || !['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) {
            return handler(req);
        }

        // Check for cached response
        const cachedResponse = await getIdempotentResponse(idempotencyKey);
        if (cachedResponse) {
            const parsed = JSON.parse(cachedResponse);
            return NextResponse.json(parsed.body, {
                status: parsed.status,
                headers: { 'X-Idempotency-Replay': 'true' },
            });
        }

        // Execute handler
        const response = await handler(req);

        // Cache successful responses
        if (response.ok) {
            const body = await response.clone().json();
            await setIdempotentResponse(
                idempotencyKey,
                JSON.stringify({ body, status: response.status })
            );
        }

        return response;
    };
}

// Cleanup in-memory cache periodically
if (typeof setInterval !== 'undefined') {
    setInterval(() => {
        const now = Date.now();
        for (const [key, entry] of idempotencyCache.entries()) {
            if (now - entry.timestamp > CACHE_TTL_MS) {
                idempotencyCache.delete(key);
            }
        }
    }, CLEANUP_INTERVAL_MS);
}
