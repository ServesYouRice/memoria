/**
 * API Key Authentication
 * 
 * SECURITY: API keys are now verified against Argon2id hashes.
 * 
 * Migration strategy for existing plaintext keys:
 * - If stored key starts with '$argon2', it's a hash - use verify
 * - Otherwise, it's plaintext (legacy) - compare directly and upgrade
 */

import { type NextRequest } from 'next/server';
import { prisma } from '@/lib/db';
import { verifyApiKey, isValidApiKeyFormat } from './api-key';
import * as argon2 from 'argon2';
import { createRateLimiter } from '@/lib/rate-limit';
import type { RateLimitResult } from '@/lib/rate-limit';

const API_KEY_RATE_LIMIT_MAX = 300;
const API_KEY_RATE_LIMIT_WINDOW = 60;
const apiKeyLimiter = createRateLimiter({
    maxRequests: API_KEY_RATE_LIMIT_MAX,
    windowSeconds: API_KEY_RATE_LIMIT_WINDOW,
    keyPrefix: 'api-key',
});

export interface ApiKeyAuthResult {
    user: {
        id: string;
        name: string | null;
        email: string;
        image: string | null;
    };
    apiKeyId: string;
    apiKeyName: string;
}

interface KeyIdentifier {
    prefix?: string;
    suffix?: string;
}

function getKeyIdentifier(key: string): KeyIdentifier {
    if (key.length < 8) {
        return {};
    }
    return {
        prefix: key.slice(0, 7),
        suffix: key.slice(-4),
    };
}

/**
 * Authenticate a request using an API key
 * 
 * @param req - The incoming request
 * @returns The authenticated user, or null if authentication failed
 */
export async function authenticateApiKey(req: NextRequest) {
    const header = req.headers.get('x-api-key');
    if (!header) return null;

    // Quick format check before database lookup
    // Allow legacy keys that don't match the new prefix as long as they are reasonably long.
    if (!isValidApiKeyFormat(header) && header.length < 20) {
        return null;
    }

    const now = new Date();
    const { prefix, suffix } = getKeyIdentifier(header);

    const lookupWhere = {
        revokedAt: null,
        OR: [
            { expiresAt: null },
            { expiresAt: { gt: now } }
        ],
        ...(suffix ? { keySuffix: suffix } : {}),
    };

    let apiKeys = await prisma.apiKey.findMany({
        where: lookupWhere,
        include: { user: true }
    });

    if (apiKeys.length === 0) {
        // Fallback to full scan for legacy keys without suffix
        apiKeys = await prisma.apiKey.findMany({
            where: {
                revokedAt: null,
                OR: [
                    { expiresAt: null },
                    { expiresAt: { gt: now } }
                ]
            },
            include: { user: true }
        });
    }

    // Find all API keys for the user to check against
    // We need to iterate because we can't query by hash directly
    for (const apiKey of apiKeys) {
        let isValid = false;
        let needsUpgrade = false;

        // Check if the stored key is a hash (starts with $argon2)
        if (apiKey.key.startsWith('$argon2')) {
            // Stored value is already a hash - verify against it
            isValid = await verifyApiKey(header, apiKey.key);
        } else {
            // Legacy plaintext key - compare directly
            // SECURITY: Timing-safe comparison would be better, but we're migrating away from this
            isValid = apiKey.key === header;
            needsUpgrade = isValid;
        }

        if (isValid) {
            // Update last used timestamp (fire-and-forget)
            const updateData: { lastUsedAt: Date; key?: string; keyPrefix?: string | null; keySuffix?: string | null } = {
                lastUsedAt: new Date()
            };

            // Upgrade legacy plaintext key to hash
            if (needsUpgrade) {
                try {
                    const hashedKey = await argon2.hash(header, {
                        type: argon2.argon2id,
                        memoryCost: 19456,
                        timeCost: 2,
                        parallelism: 1,
                    });
                    updateData.key = hashedKey;
                } catch {
                    // If hashing fails, just update lastUsedAt
                }
            }

            if (!apiKey.keyPrefix || !apiKey.keySuffix) {
                updateData.keyPrefix = prefix || apiKey.keyPrefix;
                updateData.keySuffix = suffix || apiKey.keySuffix;
            }

            prisma.apiKey.update({
                where: { id: apiKey.id },
                data: updateData
            }).catch(() => { /* fire-and-forget */ });

            return {
                user: apiKey.user,
                apiKeyId: apiKey.id,
                apiKeyName: apiKey.name,
            };
        }
    }

    return null;
}

export async function checkApiKeyRateLimit(apiKeyId: string): Promise<RateLimitResult> {
    return apiKeyLimiter.check(apiKeyId);
}

export function getApiKeyRateLimitHeaders(result: RateLimitResult): Record<string, string> {
    return {
        'X-RateLimit-Limit': String(result.limit),
        'X-RateLimit-Remaining': String(result.remaining),
        'X-RateLimit-Reset': String(result.resetAt),
        'X-RateLimit-Window': String(result.resetIn),
    };
}

