import { type NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { invalidateCanvasCache } from '@/lib/cache/canvas-cache';
import { safeFetch } from '@/lib/utils/ssrf-protection';
import { extractMetadata, validateMetadata } from '@/lib/utils/metadata-extractor';
import { ItemType } from '@/types/canvas';
import { withApiHandler } from '@/lib/api/route-handler';
import { InternalServerError, UnauthorizedError } from '@/lib/errors';

// Helper for type safety
interface BookmarkContent {
    url?: string;
    title?: string;
    description?: string;
    image?: string;
    history?: any[];
    [key: string]: any;
}

export const GET = withApiHandler(async (req: NextRequest) => {
    const authHeader = req.headers.get('authorization');
    const cronSecret = process.env.CRON_SECRET?.trim();
    if (!cronSecret) {
        throw new InternalServerError('Cron secret not configured');
    }

    if (authHeader !== `Bearer ${cronSecret}`) {
        throw new UnauthorizedError('Invalid cron secret');
    }

    // Fetch oldest updated bookmarks
    const bookmarks = await prisma.canvasItem.findMany({
        where: { type: ItemType.BOOKMARK },
        take: 10,
        orderBy: { updatedAt: 'asc' }
    });

    const results = [];
    const invalidatedCanvasIds = new Set<string>();

    for (const item of bookmarks) {
        try {
            const content = item.content as BookmarkContent;
            if (!content.url) continue;

            const fetchResult = await safeFetch(content.url, { timeout: 5000 });
            if (!fetchResult.ok || !fetchResult.data) continue;

            const metadata = extractMetadata(fetchResult.data, content.url);
            const cleaned = validateMetadata(metadata);

            // Access Typed Content
            const oldTitle = content.title;
            const newTitle = cleaned.title;
            // Simple comparison (can be more complex)
            if (oldTitle !== newTitle && newTitle) {
                // Update
                const history = content.history || [];
                history.push({
                    date: new Date().toISOString(),
                    changes: { title: { from: oldTitle, to: newTitle } }
                });

                await prisma.canvasItem.update({
                    where: { id: item.id },
                    data: {
                        content: {
                            ...content,
                            title: newTitle,
                            description: cleaned.description || content.description,
                            image: cleaned.image || content.image,
                            history
                        }
                    }
                });
                invalidatedCanvasIds.add(item.canvasId);
                results.push({ id: item.id, status: 'updated' });
            } else {
                // Just touch updatedAt
                await prisma.canvasItem.update({
                    where: { id: item.id },
                    data: { updatedAt: new Date() } // Force update to move to back of queue
                });
                invalidatedCanvasIds.add(item.canvasId);
                results.push({ id: item.id, status: 'unchanged' });
            }
        } catch {
            results.push({ id: item.id, status: 'error' });
        }
    }

    for (const canvasId of invalidatedCanvasIds) {
        await invalidateCanvasCache(canvasId);
    }

    return NextResponse.json({ results });
});
