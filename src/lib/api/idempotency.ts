import { NextResponse } from 'next/server';
import { getRedisClient } from '@/lib/cache/redis-client';
import { createLogger } from '@/lib/logger';

const logger = createLogger('idempotency');

const IDEMPOTENCY_TTL = 24 * 60 * 60; // 24 hours

interface CachedResponse {
    status: number;
    body: any;
    headers: Record<string, string>;
}

/**
 * Options for scoped idempotency keys (OPUS.md Issue #15)
 */
export interface IdempotencyKeyOptions {
    /** The client-provided idempotency key */
    key: string;
    /** The user ID making the request */
    userId: string;
    /** HTTP method (GET, POST, etc.) */
    method: string;
    /** API path (e.g., /api/v1/canvases) */
    path: string;
}

/**
 * Build a scoped idempotency key that includes user, method, and path
 * This ensures the same client key for different endpoints or users won't collide
 */
export function buildScopedKey(options: IdempotencyKeyOptions): string {
    return `idempotency:${options.userId}:${options.method}:${options.path}:${options.key}`;
}

/**
 * Check if a request with the given idempotency key has already been processed
 * @param key - Raw key string (legacy) OR scoped key from buildScopedKey
 */
export async function checkIdempotency(key: string): Promise<NextResponse | null> {
    const redis = getRedisClient();
    if (!redis) return null; // Fail open if Redis is down

    // If key doesn't start with 'idempotency:', add the prefix
    const fullKey = key.startsWith('idempotency:') ? key : `idempotency:${key}`;

    try {
        const cached = await redis.get(fullKey);
        if (!cached) return null;

        const data: CachedResponse = JSON.parse(cached);
        logger.info({ key: fullKey }, 'Idempotency hit');

        return NextResponse.json(data.body, {
            status: data.status,
            headers: {
                ...data.headers,
                'X-Idempotency-Hit': 'true',
            },
        });
    } catch (error) {
        logger.error({ error, key: fullKey }, 'Error checking idempotency');
        return null;
    }
}

/**
 * Check idempotency with scoped options
 */
export async function checkScopedIdempotency(options: IdempotencyKeyOptions): Promise<NextResponse | null> {
    return checkIdempotency(buildScopedKey(options));
}

/**
 * Store the result of a request for idempotency
 */
export async function storeIdempotencyResult(
    _key: string,
    _response: NextResponse
): Promise<void> {
    // TODO: implement with saveIdempotencyResponse once response bodies are available safely.
}

// Redefining implementation to be robust:
export async function saveIdempotencyResponse(
    key: string,
    status: number,
    body: any
): Promise<void> {
    const redis = getRedisClient();
    if (!redis) return;

    // If key doesn't start with 'idempotency:', add the prefix
    const fullKey = key.startsWith('idempotency:') ? key : `idempotency:${key}`;

    try {
        const data: CachedResponse = {
            status,
            body,
            headers: {},
        };

        await redis.setex(
            fullKey,
            IDEMPOTENCY_TTL,
            JSON.stringify(data)
        );
    } catch (error) {
        logger.error({ error, key: fullKey }, 'Error storing idempotency');
    }
}

/**
 * Save idempotency response with scoped options
 */
export async function saveScopedIdempotencyResponse(
    options: IdempotencyKeyOptions,
    status: number,
    body: any
): Promise<void> {
    return saveIdempotencyResponse(buildScopedKey(options), status, body);
}
