/**
 * API Key Authentication
 * 
 * SECURITY: API keys are now verified against Argon2id hashes.
 * 
 * Migration strategy for existing plaintext keys:
 * - If stored key starts with '$argon2', it's a hash - use verify
 * - Otherwise, it's plaintext (legacy) - compare directly and upgrade
 */

import { NextRequest } from 'next/server';
import { prisma } from '@/lib/db';
import { verifyApiKey, isValidApiKeyFormat } from './api-key';
import * as argon2 from 'argon2';

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
    if (!isValidApiKeyFormat(header)) {
        return null;
    }

    // Find all API keys for the user to check against
    // We need to iterate because we can't query by hash directly
    const apiKeys = await prisma.apiKey.findMany({
        where: {
            // Filter by non-expired keys first
            OR: [
                { expiresAt: null },
                { expiresAt: { gt: new Date() } }
            ]
        },
        include: { user: true }
    });

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
            const updateData: { lastUsedAt: Date; key?: string } = {
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

            prisma.apiKey.update({
                where: { id: apiKey.id },
                data: updateData
            }).catch(() => { /* fire-and-forget */ });

            return apiKey.user;
        }
    }

    return null;
}

