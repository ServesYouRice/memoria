import { NextRequest } from 'next/server';
import { prisma } from '@/lib/db';

export async function authenticateApiKey(req: NextRequest) {
    const header = req.headers.get('x-api-key');
    if (!header) return null;

    // Update last used
    const apiKey = await prisma.apiKey.findUnique({
        where: { key: header },
        include: { user: true }
    });

    if (!apiKey) return null;

    // Check expiration if needed
    if (apiKey.expiresAt && apiKey.expiresAt < new Date()) return null;

    // Async update lastUsed
    prisma.apiKey.update({
        where: { id: apiKey.id },
        data: { lastUsedAt: new Date() }
    }).catch(() => { });

    return apiKey.user;
}
