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
import { z } from "zod";
import { ItemType, Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { requireAuth, requireCanvasAccess } from "@/lib/api/auth";
import { ConflictError, errorResponse } from "@/lib/errors";
import { invalidateCanvasCache } from "@/lib/cache/canvas-cache";
import { runIdempotent } from "@/lib/api/route-handler";
import {
  createCanvasItemSchema,
  listCanvasItemsSchema,
  parseCanvasItemContent,
  viewportPaginationSchema,
  type ViewportPaginationInput,
} from "@/lib/validation/canvas-item";
import type { CanvasItem } from "@/generated/prisma/client";
import { ActivityType, logActivity } from "@/lib/activity";
import { requirePollsEnabled } from "@/lib/polls/availability";
import { recordCanvasItemEvent } from "@/lib/collaboration/committed-events";
import { assertCanvasItemCapacity } from "@/lib/policy/capacity";
import {
  boundedItemsResponse,
  decodeItemCursor,
} from "@/lib/api/bounded-response";
import { lockCanvasForMutation } from "@/lib/canvas/mutation-lock";

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
      requirePollsEnabled(data.type);
      const validatedContent = parseCanvasItemContent(data.type, data.content);

      // Verify user has EDIT permission (via ownership or share)
      await requireCanvasAccess(data.canvasId, userId, email, "EDIT");

      // Create item
      const item = await prisma.$transaction(async (tx) => {
        await lockCanvasForMutation(tx, data.canvasId);
        await assertCanvasItemCapacity(tx, data.canvasId);
        const created = await tx.canvasItem.create({
          data: {
            canvasId: data.canvasId,
            type: data.type,
            positionX: data.positionX,
            positionY: data.positionY,
            width: data.width,
            height: data.height,
            zIndex: data.zIndex,
            content: (validatedContent ??
              Prisma.JsonNull) as Prisma.InputJsonValue,
            tags: data.tags || [],
            version: 1,
            createdById: userId,
            updatedById: userId,
          },
        });
        await recordCanvasItemEvent(tx, {
          canvasId: data.canvasId,
          actorId: userId,
          itemId: created.id,
          version: created.version,
          operation: "created",
        });
        return created;
      });

      // Invalidate canvas cache
      await invalidateCanvasCache(data.canvasId);

      await logActivity({
        userId,
        type: ActivityType.ITEM_CREATED,
        canvasId: data.canvasId,
        itemId: item.id,
      });

      return NextResponse.json(item, { status: 201 });
    });
  } catch (error) {
    return errorResponse(error, request.url);
  }
}

const batchPositionSchema = z.object({
  canvasId: z.string().cuid(),
  items: z
    .array(
      z.object({
        id: z.string().cuid(),
        version: z.number().int().positive(),
        positionX: z.number().finite(),
        positionY: z.number().finite(),
      }),
    )
    .min(1)
    .max(500),
});

/** Atomically apply a bounded layout change without leaving a partial canvas. */
export async function PATCH(request: NextRequest) {
  try {
    const { userId, email } = await requireAuth();
    const data = batchPositionSchema.parse(await request.json());
    await requireCanvasAccess(data.canvasId, userId, email, "EDIT");

    await prisma.$transaction(async (tx) => {
      await lockCanvasForMutation(tx, data.canvasId);
      for (const item of data.items) {
        const updated = await tx.canvasItem.updateMany({
          where: {
            id: item.id,
            canvasId: data.canvasId,
            version: item.version,
            deletedAt: null,
          },
          data: {
            positionX: item.positionX,
            positionY: item.positionY,
            version: { increment: 1 },
            updatedById: userId,
          },
        });
        if (updated.count !== 1) {
          throw new ConflictError(
            "Canvas changed while the layout was being prepared. Refresh and try again.",
          );
        }
        await recordCanvasItemEvent(tx, {
          canvasId: data.canvasId,
          actorId: userId,
          itemId: item.id,
          version: item.version + 1,
          operation: "updated",
        });
      }
    });

    await invalidateCanvasCache(data.canvasId);
    return NextResponse.json({ updated: data.items.length });
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
          cursor: searchParams.get("cursor") || undefined,
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
          cursor: searchParams.get("cursor") || undefined,
        });

    // Verify user has VIEW permission (via ownership or share)
    const accessLevel = await requireCanvasAccess(
      query.canvasId,
      userId,
      email,
      "VIEW",
    );
    if (query.type) requirePollsEnabled(query.type);
    if (query.includeDeleted && accessLevel !== "OWNER") {
      await requireCanvasAccess(query.canvasId, userId, email, "OWNER");
    }

    // Base where clause (always applied)
    const baseWhere = {
      canvasId: query.canvasId,
      type: query.type ?? { not: ItemType.POLL },
      ...(query.includeDeleted ? {} : { deletedAt: null }),
    };

    const cursorTarget = decodeItemCursor(query.cursor);

    // Apply viewport filtering if viewport parameters are provided
    if (hasViewportParams) {
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

      // Parameterized fragments keep the optional predicates injection-safe.

      // Build type filter fragment
      const typeFilter = query.type
        ? Prisma.sql`AND "type" = ${query.type}::\"ItemType\"`
        : Prisma.sql`AND "type" <> 'POLL'::\"ItemType\"`;

      // Build deleted filter fragment
      const deletedFilter = query.includeDeleted
        ? Prisma.empty
        : Prisma.sql`AND "deletedAt" IS NULL`;

      const cursorFilter = cursorTarget
        ? Prisma.sql`AND ("zIndex" > ${cursorTarget.zIndex} OR ("zIndex" = ${cursorTarget.zIndex} AND "id" > ${cursorTarget.id}))`
        : Prisma.empty;

      const paginationFragment = cursorTarget
        ? Prisma.empty
        : Prisma.sql`OFFSET ${offset}`;

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
          ${cursorFilter}
          AND ("positionX" + "width") >= ${minX}
          AND "positionX" <= ${maxX}
          AND ("positionY" + "height") >= ${minY}
          AND "positionY" <= ${maxY}
        ORDER BY "zIndex" ASC, "id" ASC
        LIMIT ${limit} ${paginationFragment}
      `;

      // Return with pagination metadata
      return boundedItemsResponse(items, {
        total,
        offset: cursorTarget ? undefined : offset,
        limit,
        hasMore: cursorTarget ? undefined : offset + items.length < total,
      });
    }

    const { limit, offset } = query;
    const total = await prisma.canvasItem.count({ where: baseWhere });

    const items = cursorTarget
      ? await prisma.canvasItem.findMany({
          where: {
            ...baseWhere,
            OR: [
              { zIndex: { gt: cursorTarget.zIndex } },
              { zIndex: cursorTarget.zIndex, id: { gt: cursorTarget.id } },
            ],
          },
          orderBy: [{ zIndex: "asc" }, { id: "asc" }],
          take: limit,
        })
      : await prisma.canvasItem.findMany({
          where: baseWhere,
          orderBy: [{ zIndex: "asc" }, { id: "asc" }],
          take: limit,
          skip: offset,
        });

    return boundedItemsResponse(items, {
      total,
      offset: cursorTarget ? undefined : offset,
      limit,
      hasMore: cursorTarget ? undefined : offset + items.length < total,
    });
  } catch (error) {
    return errorResponse(error, request.url);
  }
}
