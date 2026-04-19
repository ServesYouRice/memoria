/**
 * Canvas Items API Routes
 * POST /api/v1/canvas-items - Create a new canvas item (NOTE or BOOKMARK)
 * GET /api/v1/canvas-items?canvasId={id} - List canvas items
 *   Optional viewport-based pagination:
 *   ?minX=0&maxX=1000&minY=0&maxY=1000&limit=100&offset=0
 *
 * Following ADR-0001: API Versioning & Error Contract
 * Following ADR-0009: Autosave & Concurrency Control
 */

import { type NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { requireAuth, requireCanvasAccess } from "@/lib/api/auth";
import { errorResponse } from "@/lib/errors";
import { invalidateCanvasCache } from "@/lib/cache/canvas-cache";
import { runIdempotent } from "@/lib/api/route-handler";
import {
  createCanvasItemSchema,
  listCanvasItemsSchema,
  parseCanvasItemContent,
  viewportPaginationSchema,
  type ViewportPaginationInput,
} from "@/lib/validation/canvas-item";
import type { CanvasItem } from "@prisma/client";

/**
 * POST /api/v1/canvas-items
 * Create a new canvas item (NOTE or BOOKMARK)
 * Phase 3: Supports shared canvas access with EDIT permission
 */
export async function POST(request: NextRequest) {
  try {
    const { userId, email } = await requireAuth();
    return await runIdempotent(request, userId, async () => {
      const body = await request.json();

      // Validate input
      const data = createCanvasItemSchema.parse(body);
      const validatedContent = parseCanvasItemContent(data.type, data.content);

      // Verify user has EDIT permission (via ownership or share)
      await requireCanvasAccess(data.canvasId, userId, email, "EDIT");

      // Create item
      const item = await prisma.canvasItem.create({
        data: {
          canvasId: data.canvasId,
          type: data.type,
          positionX: data.positionX,
          positionY: data.positionY,
          width: data.width,
          height: data.height,
          zIndex: data.zIndex,
          content: validatedContent ?? Prisma.JsonNull,
          tags: data.tags || [],
          version: 1,
          createdById: userId,
          updatedById: userId,
        },
      });

      // Invalidate canvas cache
      await invalidateCanvasCache(data.canvasId);

      return NextResponse.json(item, { status: 201 });
    });
  } catch (error) {
    return errorResponse(error, request.url);
  }
}

/**
 * GET /api/v1/canvas-items?canvasId={id}&type={NOTE|BOOKMARK}
 *
 * Phase 3: Supports shared canvas access with VIEW permission
 *
 * Supports viewport-based pagination:
 * - If minX, maxX, minY, maxY are provided: filters items by viewport intersection
 * - If viewport params are omitted: returns all items (backwards compatible)
 *
 * Pagination parameters:
 * - limit: max items to return (default 100, max 1000)
 * - offset: skip n items (default 0)
 *
 * Performance:
 * - Uses canvasId index for fast canvas filtering
 * - Uses deletedAt index for soft delete filtering
 * - Viewport filtering is done in memory (Prisma limitation),
 *   but the combination of canvasId+deletedAt index pre-filters efficiently
 */
export async function GET(request: NextRequest) {
  try {
    const { userId, email } = await requireAuth();
    const searchParams = request.nextUrl.searchParams;

    // Check if viewport parameters are provided
    const hasViewportParams =
      searchParams.has("minX") ||
      searchParams.has("maxX") ||
      searchParams.has("minY") ||
      searchParams.has("maxY");

    // Parse query params with viewport support
    const query = hasViewportParams
      ? viewportPaginationSchema.parse({
          canvasId: searchParams.get("canvasId"),
          type: searchParams.get("type") || undefined,
          includeDeleted: searchParams.get("includeDeleted") === "true",
          minX: searchParams.has("minX")
            ? parseFloat(searchParams.get("minX")!)
            : undefined,
          maxX: searchParams.has("maxX")
            ? parseFloat(searchParams.get("maxX")!)
            : undefined,
          minY: searchParams.has("minY")
            ? parseFloat(searchParams.get("minY")!)
            : undefined,
          maxY: searchParams.has("maxY")
            ? parseFloat(searchParams.get("maxY")!)
            : undefined,
          limit: searchParams.has("limit")
            ? parseInt(searchParams.get("limit")!, 10)
            : 100,
          offset: searchParams.has("offset")
            ? parseInt(searchParams.get("offset")!, 10)
            : 0,
        })
      : listCanvasItemsSchema.parse({
          canvasId: searchParams.get("canvasId"),
          type: searchParams.get("type") || undefined,
          includeDeleted: searchParams.get("includeDeleted") === "true",
          limit: searchParams.has("limit")
            ? parseInt(searchParams.get("limit")!, 10)
            : undefined,
          offset: searchParams.has("offset")
            ? parseInt(searchParams.get("offset")!, 10)
            : undefined,
        });

    // Verify user has VIEW permission (via ownership or share)
    await requireCanvasAccess(query.canvasId, userId, email, "VIEW");

    // Base where clause (always applied)
    const baseWhere = {
      canvasId: query.canvasId,
      ...(query.type && { type: query.type }),
      ...(query.includeDeleted ? {} : { deletedAt: null }),
    };

    // Apply viewport filtering if viewport parameters are provided
    if (hasViewportParams) {
      // FIXED: Use proper type instead of 'as any'
      const { minX, maxX, minY, maxY, limit, offset } =
        query as ViewportPaginationInput;

      // OPTIMIZATION: Use database-level filtering instead of in-memory filtering
      // This significantly improves performance for large canvases (1000+ items)
      //
      // Intersection algorithm (implemented in SQL):
      // (item.positionX + item.width) >= minX  &&  // item right edge >= viewport left
      // item.positionX <= maxX                 &&  // item left edge <= viewport right
      // (item.positionY + item.height) >= minY &&  // item bottom edge >= viewport top
      // item.positionY <= maxY                     // item top edge <= viewport bottom

      // FIXED: Use parameterized queries instead of string concatenation
      // This prevents SQL injection even though inputs are validated

      // Build type filter fragment
      const typeFilter = query.type
        ? Prisma.sql`AND "type" = ${query.type}::\"ItemType\"`
        : Prisma.empty;

      // Build deleted filter fragment
      const deletedFilter = query.includeDeleted
        ? Prisma.empty
        : Prisma.sql`AND "deletedAt" IS NULL`;

      // Get total count for pagination with parameterized query
      const countResult = await prisma.$queryRaw<[{ count: bigint }]>`
        SELECT COUNT(*)::int as count
        FROM "CanvasItem"
        WHERE "canvasId" = ${query.canvasId}
          ${typeFilter}
          ${deletedFilter}
          AND ("positionX" + "width") >= ${minX}
          AND "positionX" <= ${maxX}
          AND ("positionY" + "height") >= ${minY}
          AND "positionY" <= ${maxY}
      `;
      const total = Number(countResult[0]?.count || 0);

      // Fetch items with viewport filtering using parameterized query
      const items = await prisma.$queryRaw<CanvasItem[]>`
        SELECT *
        FROM "CanvasItem"
        WHERE "canvasId" = ${query.canvasId}
          ${typeFilter}
          ${deletedFilter}
          AND ("positionX" + "width") >= ${minX}
          AND "positionX" <= ${maxX}
          AND ("positionY" + "height") >= ${minY}
          AND "positionY" <= ${maxY}
        ORDER BY "zIndex" ASC, "createdAt" ASC
        LIMIT ${limit} OFFSET ${offset}
      `;

      // Return with pagination metadata
      return NextResponse.json({ items, total, offset, limit });
    }

    const { limit, offset } = query;
    const total = await prisma.canvasItem.count({ where: baseWhere });

    const items = await prisma.canvasItem.findMany({
      where: baseWhere,
      orderBy: [{ zIndex: "asc" }, { createdAt: "asc" }],
      take: limit,
      skip: offset,
    });

    return NextResponse.json({
      items,
      total,
      offset,
      limit,
      hasMore: offset + items.length < total,
    });
  } catch (error) {
    return errorResponse(error, request.url);
  }
}
