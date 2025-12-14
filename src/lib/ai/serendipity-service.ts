
import { prisma } from '@/lib/db';
import { CanvasItem, Prisma } from '@prisma/client';

export interface SerendipityResult {
    item: CanvasItem;
    reason: string;
    similarityScore: number;
}

/**
 * Serendipity Engine: Surfaces relevant items from other canvases.
 * Currently uses a heuristic-based approach (Topic matching & Randomness)
 * as a proxy for full Vector Search which requires external infrastructure (Pinecone/pgvector).
 */
export async function findSerendipitousItems(
    userId: string,
    currentCanvasId: string,
    contextKeywords: string[] = [],
    limit: number = 3
): Promise<SerendipityResult[]> {
    // 1. Fetch candidate items from OTHER canvases owned by the user
    // We restrict to Notes and Text to ensure content relevance
    const candidates = await prisma.canvasItem.findMany({
        where: {
            canvas: {
                userId: userId,
                NOT: {
                    id: currentCanvasId
                }
            },
            type: {
                in: ['NOTE', 'TEXT']
            },
            content: {
                not: Prisma.JsonNull
            }
        },
        orderBy: {
            updatedAt: 'desc' // Bias towards recently active thoughts? Or random?
        },
        take: 100 // Sample size
    });

    if (candidates.length === 0) {
        return [];
    }

    // 2. Simple 'Relevance' Scoring based on keywords
    // If no keywords provided, we rely on pure serendipity (randomness)
    const scored = candidates.map(item => {
        let score = Math.random() * 0.3; // Base entropy
        let reason = "Random rediscovery";

        const contentStr = JSON.stringify(item.content).toLowerCase();

        if (contextKeywords.length > 0) {
            let matches = 0;
            contextKeywords.forEach(kw => {
                if (contentStr.includes(kw.toLowerCase())) {
                    matches++;
                }
            });

            if (matches > 0) {
                score += matches * 0.5;
                reason = `Matches topics: ${contextKeywords.slice(0, 2).join(', ')}`;
            }
        }

        return { item, score, reason };
    });

    // 3. Sort and pick top K
    return scored
        .sort((a, b) => b.score - a.score)
        .slice(0, limit)
        .map(s => ({
            item: s.item,
            reason: s.reason,
            similarityScore: s.score
        }));
}


