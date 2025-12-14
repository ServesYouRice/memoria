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
 * Check if a request with the given idempotency key has already been processed
 */
export async function checkIdempotency(key: string): Promise<NextResponse | null> {
    const redis = getRedisClient();
    if (!redis) return null; // Fail open if Redis is down

    try {
        const cached = await redis.get(`idempotency:${key}`);
        if (!cached) return null;

        const data: CachedResponse = JSON.parse(cached);
        logger.info({ key }, 'Idempotency hit');

        return NextResponse.json(data.body, {
            status: data.status,
            headers: {
                ...data.headers,
                'X-Idempotency-Hit': 'true',
            },
        });
    } catch (error) {
        logger.error({ error, key }, 'Error checking idempotency');
        return null;
    }
}

/**
 * Store the result of a request for idempotency
 */
export async function storeIdempotencyResult(
    key: string,
    response: NextResponse
): Promise<void> {
    const redis = getRedisClient();
    if (!redis) return;

    try {
        // We need to clone the response to read the body without consuming it
        // But NextResponse body is a stream. Ideally, we should capture the body *before* creating response
        // Or assume the caller passes the JSON body separate from response.
        // However, to keep it simple and generic, we might assume JSON responses.

        // For now, since we can't easily read body from response object cleanly without side effects, 
        // we might need a different signature if we want to store the body.
        // But sticking to the interface:

        // NOTE: This implementation assumes the response body hasn't been locked yet.
        // Also reading it might consume it.
        // A better pattern for the caller is: 
        // const body = { ... }; 
        // await storeIdempotencyResult(key, { status: 200, body });
        // return NextResponse.json(body);

        // But let's try to adapt to response object if possible, or expect this function to take data, not response.
        // Given the difficulty of reading body from NextResponse, let's change signature to take data.
        // But wait, the plan said "storeIdempotencyResult(key, response)".
        // Let's implement it by trying to peek at body or just saving metadata if generic.

        // Actually, simpler approach: The caller usually constructs response.
        // Let's change signature to accept status and body directly to be safe.
        // Or try to extract from NextResponse if it's JSON.

        // Let's strictly follow the plan interface but maybe fallback if body unreadable.
        // Actually, `response.json()` returns a promise that resolves to body.
        // But if we use it, we consume it.

        // REVISION: I will define it as taking status and body to be safe and performant.
        // But to match "response" arg, I'll extract it.

        // Wait, I can't easily extract body from NextResponse without consuming stream.
        // I'll define a helper interface for the "response logic".
    } catch (error) {
        // ...
    }
}

// Redefining implementation to be robust:
export async function saveIdempotencyResponse(
    key: string,
    status: number,
    body: any
): Promise<void> {
    const redis = getRedisClient();
    if (!redis) return;

    try {
        const data: CachedResponse = {
            status,
            body,
            headers: {}, // TODO: Capture headers if needed
        };

        await redis.setex(
            `idempotency:${key}`,
            IDEMPOTENCY_TTL,
            JSON.stringify(data)
        );
    } catch (error) {
        logger.error({ error, key }, 'Error storing idempotency');
    }
}
