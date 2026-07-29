/**
 * Global Search API
 * Search across all user's canvases and items
 *
 * Uses PostgreSQL Full-Text Search for fast, ranked results.
 * Falls back to ILIKE if searchVector column is not available.
 */

import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { Prisma } from "@prisma/client";

import { stripHtmlTags } from "@/lib/utils/html";
import { logger } from "@/lib/logger";
import { parsePagination } from "@/lib/api/pagination";
import { BadRequestError } from "@/lib/errors";
import { withAuth } from "@/lib/api/route-handler";

interface SearchResult {
  itemId: string;
  canvasId: string;
  canvasName: string;
  itemType: string;
  content: unknown;
  tags: string[];
  snippet: string;
  createdAt: string;
  updatedAt: string;
}

let ftsAvailable: boolean | null = null;

async function hasSearchVectorColumn(): Promise<boolean> {
  if (ftsAvailable !== null) return ftsAvailable;

  try {
    const result = await prisma.$queryRaw<[{ exists: boolean }]>`
      SELECT EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'CanvasItem'
          AND column_name = 'searchVector'
      ) AS "exists"
    `;

    ftsAvailable = Boolean(result[0]?.exists);
  } catch (error) {
    logger.warn(
      { error },
      "Failed to detect searchVector column, falling back to ILIKE search",
    );
    return false;
  }

  return ftsAvailable;
}

/**
 * Search across all canvases and items
 * GET /api/v1/search?q=query&tags=tag1,tag2&canvasId=id
 */
export const GET = withAuth(async (request, session) => {
  const { searchParams } = new URL(request.url);
  const rawQuery = searchParams.get("q");
  const tagsParam = searchParams.get("tags");
  const canvasIdFilter = searchParams.get("canvasId");
  const { limit, offset } = parsePagination(searchParams);

  if (!rawQuery || rawQuery.trim().length < 2) {
    throw new BadRequestError("Search query must be at least 2 characters");
  }

  const query = rawQuery.trim();
  if (query.length > 200) {
    throw new BadRequestError("Search query must be at most 200 characters");
  }
  const tags = tagsParam
    ? tagsParam
        .split(",")
        .map((t) => t.trim())
        .filter(Boolean)
    : [];
  if (tags.length > 10 || tags.some((tag) => tag.length > 50)) {
    throw new BadRequestError(
      "Search supports at most 10 tags of 50 characters each",
    );
  }
  const userId = session.user.id;

  logger.info(
    { userId, queryLength: query.length, tagCount: tags.length },
    "Executing search",
  );

  /**
   * Full-Text Search using PostgreSQL tsvector
   * Falls back to ILIKE if searchVector column is not available
   *
   * The searchVector column is a generated column created by:
   * prisma/fts-migration.sql
   */

  const accessFilter = Prisma.sql`
    (
      c."userId" = ${userId}
      OR EXISTS (
        SELECT 1 FROM "CanvasShare" s
        WHERE s."canvasId" = c."id"
          AND s."recipientId" = ${userId}
      )
    )
  `;
  const canvasFilter = canvasIdFilter
    ? Prisma.sql`AND i."canvasId" = ${canvasIdFilter}`
    : Prisma.empty;
  const tagsFilter =
    tags.length > 0
      ? Prisma.sql`AND i."tags" @> ${tags}::text[]`
      : Prisma.empty;

  const useFts = await hasSearchVectorColumn();

  const escapedQuery = query.replace(/[\\%_]/g, "\\$&");
  const searchTerm = `%${escapedQuery}%`;
  const tsQuery = Prisma.sql`plainto_tsquery('english', ${query})`;

  // Use FTS with plainto_tsquery for proper word stemming and ranking
  // This is much faster than ILIKE and provides relevance ranking
  // FTS filter - uses the generated searchVector column when available
  const searchFilter = useFts
    ? Prisma.sql`
        AND (
          i."searchVector" @@ ${tsQuery}
          OR i."content"->>'text' ILIKE ${searchTerm} ESCAPE '\\'
          OR i."content"->>'title' ILIKE ${searchTerm} ESCAPE '\\'
          OR i."content"->>'description' ILIKE ${searchTerm} ESCAPE '\\'
          OR i."content"->>'url' ILIKE ${searchTerm} ESCAPE '\\'
        )
      `
    : Prisma.sql`
        AND (
          i."content"->>'text' ILIKE ${searchTerm} ESCAPE '\\'
          OR i."content"->>'title' ILIKE ${searchTerm} ESCAPE '\\'
          OR i."content"->>'description' ILIKE ${searchTerm} ESCAPE '\\'
          OR i."content"->>'url' ILIKE ${searchTerm} ESCAPE '\\'
        )
      `;

  const rankSelect = useFts
    ? Prisma.sql`, ts_rank(COALESCE(i."searchVector", ''::tsvector), ${tsQuery}) as rank`
    : Prisma.sql`, 0 as rank`;

  const orderBy = useFts
    ? Prisma.sql`ORDER BY rank DESC, i."updatedAt" DESC`
    : Prisma.sql`ORDER BY i."updatedAt" DESC`;

  // Count query
  const countResult = await prisma.$queryRaw<[{ count: bigint }]>`
      SELECT COUNT(*)::int as count
      FROM "CanvasItem" i
      JOIN "Canvas" c ON i."canvasId" = c."id"
      WHERE 
        ${accessFilter}
        AND i."deletedAt" IS NULL
        ${canvasFilter}
        ${tagsFilter}
        ${searchFilter}
    `;

  const total = Number(countResult[0]?.count || 0);

  const [typeFacetRows, tagFacetRows] = await Promise.all([
    prisma.$queryRaw<Array<{ value: string; count: number }>>`
      SELECT i."type"::text AS value, COUNT(*)::int AS count
      FROM "CanvasItem" i JOIN "Canvas" c ON i."canvasId" = c."id"
      WHERE ${accessFilter} AND i."deletedAt" IS NULL
        ${canvasFilter} ${tagsFilter} ${searchFilter}
      GROUP BY i."type" ORDER BY count DESC, value
    `,
    prisma.$queryRaw<Array<{ value: string; count: number }>>`
      SELECT tag AS value, COUNT(*)::int AS count
      FROM "CanvasItem" i JOIN "Canvas" c ON i."canvasId" = c."id",
        LATERAL unnest(i."tags") AS tag
      WHERE ${accessFilter} AND i."deletedAt" IS NULL
        ${canvasFilter} ${tagsFilter} ${searchFilter}
      GROUP BY tag ORDER BY count DESC, value LIMIT 100
    `,
  ]);

  // Main query with relevance ranking
  // ts_rank orders results by relevance to the query
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
        ${rankSelect}
      FROM "CanvasItem" i
      JOIN "Canvas" c ON i."canvasId" = c."id"
      WHERE 
        ${accessFilter}
        AND i."deletedAt" IS NULL
        ${canvasFilter}
        ${tagsFilter}
        ${searchFilter}
      ${orderBy}
      LIMIT ${limit} OFFSET ${offset};
    `;

  // Create results with snippets
  const queryLower = query.toLowerCase();
  const results: SearchResult[] = items.map((item) => {
    const content = item.content as Record<string, unknown>;
    let snippet = "";

    if (item.type === "NOTE") {
      const plainText =
        typeof content.plainText === "string"
          ? content.plainText
          : stripHtmlTags((content.text as string) || "");
      const index = plainText.toLowerCase().indexOf(queryLower);
      if (index !== -1) {
        const start = Math.max(0, index - 50);
        const end = Math.min(plainText.length, index + queryLower.length + 50);
        snippet =
          (start > 0 ? "..." : "") +
          plainText.substring(start, end) +
          (end < plainText.length ? "..." : "");
      } else {
        snippet = plainText.substring(0, 100) + "...";
      }
    } else if (item.type === "BOOKMARK") {
      snippet = (content.title as string) || (content.url as string) || "";
    } else if (item.type === "IMAGE") {
      snippet =
        (content.alt as string) || (content.filename as string) || "Image";
    } else {
      snippet =
        ([content.title, content.text, content.description, content.url].find(
          (value) => typeof value === "string",
        ) as string | undefined) || item.type;
    }

    return {
      itemId: item.id,
      canvasId: item.canvasId,
      canvasName: item.canvasName,
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
    totalResults: total,
    results,
    pagination: {
      total,
      limit,
      offset,
      hasMore: offset + results.length < total,
    },
    facets: {
      types: typeFacetRows.map((row) => ({
        value: row.value,
        count: Number(row.count),
      })),
      tags: tagFacetRows.map((row) => ({
        value: row.value,
        count: Number(row.count),
      })),
    },
  });
});
