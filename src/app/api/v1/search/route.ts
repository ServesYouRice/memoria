/**
 * Global Search API
 * Search across all user's canvases and items
 */

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { prisma } from '@/lib/db';
import { authOptions } from '@/lib/auth';
import { UnauthorizedError, ValidationError } from '@/lib/errors';
import { stripHtmlTags } from '@/lib/utils/html';

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
export async function GET(request: NextRequest) {
  const session = await getServerSession(authOptions);

  if (!session?.user?.id) {
    throw new UnauthorizedError('You must be logged in');
  }

  const { searchParams } = new URL(request.url);
  const query = searchParams.get('q');
  const tagsParam = searchParams.get('tags');
  const canvasIdFilter = searchParams.get('canvasId');

  if (!query || query.trim().length < 2) {
    throw new ValidationError('Search query must be at least 2 characters');
  }

  const tags = tagsParam ? tagsParam.split(',').map((t) => t.trim()).filter(Boolean) : [];

  // Build the where clause
  const where: any = {
    canvas: {
      userId: session.user.id,
    },
    deletedAt: null,
  };

  // Filter by canvas if specified
  if (canvasIdFilter) {
    where.canvasId = canvasIdFilter;
  }

  // Filter by tags if specified
  if (tags.length > 0) {
    where.tags = {
      hasEvery: tags,
    };
  }

  // Search for items
  const items = await prisma.canvasItem.findMany({
    where,
    include: {
      canvas: {
        select: {
          id: true,
          name: true,
        },
      },
    },
    orderBy: {
      updatedAt: 'desc',
    },
    take: 50, // Limit results
  });

  // Filter by content search and create results
  const queryLower = query.toLowerCase();
  const results: SearchResult[] = items
    .filter((item) => {
      const content = item.content as any;
      if (item.type === 'NOTE') {
        // Strip HTML tags before searching
        const plainText = stripHtmlTags(content.text || '');
        return plainText.toLowerCase().includes(queryLower);
      } else if (item.type === 'BOOKMARK') {
        return (
          content.url?.toLowerCase().includes(queryLower) ||
          content.title?.toLowerCase().includes(queryLower) ||
          content.description?.toLowerCase().includes(queryLower) ||
          content.siteName?.toLowerCase().includes(queryLower)
        );
      } else if (item.type === 'IMAGE') {
        return (
          content.filename?.toLowerCase().includes(queryLower) ||
          content.alt?.toLowerCase().includes(queryLower)
        );
      }
      return false;
    })
    .map((item) => {
      const content = item.content as any;
      let snippet = '';

      if (item.type === 'NOTE') {
        // Strip HTML tags for snippet as well
        const plainText = stripHtmlTags(content.text || '');
        const index = plainText.toLowerCase().indexOf(queryLower);
        const start = Math.max(0, index - 50);
        const end = Math.min(plainText.length, index + queryLower.length + 50);
        snippet = (start > 0 ? '...' : '') + plainText.substring(start, end) + (end < plainText.length ? '...' : '');
      } else if (item.type === 'BOOKMARK') {
        snippet = content.title || content.url || '';
      } else if (item.type === 'IMAGE') {
        snippet = content.alt || content.filename || 'Image';
      }

      return {
        itemId: item.id,
        canvasId: item.canvasId,
        canvasName: item.canvas.name,
        itemType: item.type,
        content: item.content,
        tags: item.tags || [],
        snippet,
        createdAt: item.createdAt.toISOString(),
        updatedAt: item.updatedAt.toISOString(),
      };
    });

  return NextResponse.json({
    query,
    tags,
    totalResults: results.length,
    results,
  });
}
