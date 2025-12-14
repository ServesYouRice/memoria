/**
 * Global Search API
 * Search across all user's canvases and items
 */

import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { Prisma } from '@prisma/client';

import { stripHtmlTags } from '@/lib/utils/html';
import { logger } from '@/lib/logger';

interface SearchResult {
  itemId: string;
  canvasId: string;
  canvasName: string;
  itemType: string;
  content: any;
  tags: string[];
  snippet: string;
  createdAt: string;
  updatedAt: string;
}

/**
 * Search across all canvases and items
 * GET /api/v1/search?q=query&tags=tag1,tag2&canvasId=id
 */
import { withAuth } from '@/lib/api/route-handler';

export const GET = withAuth<any>(async (request, session) => {
  const { searchParams } = new URL(request.url);
  const query = searchParams.get('q');
  const tagsParam = searchParams.get('tags');
  const canvasIdFilter = searchParams.get('canvasId');

  if (!query || query.trim().length < 2) {
    return NextResponse.json({ error: 'Search query must be at least 2 characters' }, { status: 400 });
  }

  const tags = tagsParam ? tagsParam.split(',').map((t) => t.trim()).filter(Boolean) : [];
  const userId = session.user.id;

  logger.info({ userId, query, tags }, 'Executing search');

  /**
   * Optimized Search using Raw SQL for case-insensitive JSON search
   * We select items where:
   * 1. Canvas belongs to user
   * 2. Item is not deleted
   * 3. Matches tags (if provided)
   * 4. Matches query in content (case insensitive)
   */

  const searchTerm = `%${query}%`;

  // Using prisma.$queryRaw for maximum control over the JSON search
  const items = await prisma.$queryRaw<any[]>`
      SELECT 
        i."id", 
        i."canvasId", 
        i."type", 
        i."content", 
        i."tags", 
        i."createdAt", 
        i."updatedAt",
        c."name" as "canvasName"
      FROM "CanvasItem" i
      JOIN "Canvas" c ON i."canvasId" = c."id"
      WHERE 
        c."userId" = ${userId}
        AND i."deletedAt" IS NULL
        AND (
          ${canvasIdFilter ? Prisma.sql`i."canvasId" = ${canvasIdFilter} AND` : Prisma.empty}
          true
        )
        AND (
          ${tags.length > 0 ? Prisma.sql`i."tags" @> ${tags}::text[] AND` : Prisma.empty}
          true
        )
        AND (
          -- Case insensitive search across common text fields in JSON
          i."content"->>'text' ILIKE ${searchTerm}
          OR i."content"->>'title' ILIKE ${searchTerm}
          OR i."content"->>'description' ILIKE ${searchTerm}
          OR i."content"->>'url' ILIKE ${searchTerm}
          OR i."content"->>'alt' ILIKE ${searchTerm}
          OR i."content"->>'name' ILIKE ${searchTerm}
          OR i."content"->>'filename' ILIKE ${searchTerm}
        )
      ORDER BY i."updatedAt" DESC
      LIMIT 50;
    `;

  // Create results with snippets
  const queryLower = query.toLowerCase();
  const results: SearchResult[] = items.map((item) => {
    const content = item.content as any;
    let snippet = '';

    if (item.type === 'NOTE') {
      const plainText = stripHtmlTags(content.text || '');
      const index = plainText.toLowerCase().indexOf(queryLower);
      if (index !== -1) {
        const start = Math.max(0, index - 50);
        const end = Math.min(plainText.length, index + queryLower.length + 50);
        snippet = (start > 0 ? '...' : '') + plainText.substring(start, end) + (end < plainText.length ? '...' : '');
      } else {
        snippet = plainText.substring(0, 100) + '...';
      }
    } else if (item.type === 'BOOKMARK') {
      snippet = content.title || content.url || '';
    } else if (item.type === 'IMAGE') {
      snippet = content.alt || content.filename || 'Image';
    }

    return {
      itemId: item.id,
      canvasId: item.canvasId,
      canvasName: item.canvasName, // Joined column
      itemType: item.type,
      content: item.content,
      tags: item.tags || [],
      snippet,
      createdAt: new Date(item.createdAt).toISOString(),
      updatedAt: new Date(item.updatedAt).toISOString(),
    };
  });

  return NextResponse.json({
    query,
    tags,
    totalResults: results.length,
    results,
  });
});
