/**
 * Canvas Item API Routes (Individual Item)
 * GET /api/v1/canvas-items/{itemId} - Get a specific item
 * PATCH /api/v1/canvas-items/{itemId} - Update an item (with optimistic locking)
 * DELETE /api/v1/canvas-items/{itemId} - Soft delete an item
 *
 * Following ADR-0009: Optimistic Concurrency Control
 * Phase 3: Supports shared canvas access
 */

import { type NextRequest, NextResponse } from "next/server";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { requireAuth, requireItemAccess } from "@/lib/api/auth";
import {
  errorResponse,
  NotFoundError,
  VersionMismatchError,
} from "@/lib/errors";
import { invalidateCanvasCache } from "@/lib/cache/canvas-cache";
import {
  updateCanvasItemSchema,
  deleteCanvasItemSchema,
  parseCanvasItemContent,
} from "@/lib/validation/canvas-item";
import { ActivityType, logActivity } from "@/lib/activity";
import { requirePollsEnabled } from "@/lib/polls/availability";
import { recordCanvasItemEvent } from "@/lib/collaboration/committed-events";
import { lockCanvasForMutation } from "@/lib/canvas/mutation-lock";

interface RouteContext {
  params: Promise<{ itemId: string }>;
}

/**
 * GET /api/v1/canvas-items/{itemId}
 * Get a specific canvas item
 * Phase 3: Requires VIEW permission
 */
export async function GET(request: NextRequest, { params }: RouteContext) {
  try {
    const { userId, email } = await requireAuth();
    const { itemId } = await params;

    // Verify user has VIEW permission
    await requireItemAccess(itemId, userId, email, "VIEW");

    // Fetch item
    const item = await prisma.canvasItem.findUnique({
      where: { id: itemId },
    });

    if (!item || item.deletedAt) {
      throw new NotFoundError("Item not found");
    }
    requirePollsEnabled(item.type);

    return NextResponse.json(item);
  } catch (error) {
    return errorResponse(error, request.url);
  }
}

/**
 * PATCH /api/v1/canvas-items/{itemId}
 * Update a canvas item with optimistic locking
 *
 * This implements ADR-0009: version field must match for update to succeed
 * Phase 3: Requires EDIT permission
 */
export async function PATCH(request: NextRequest, { params }: RouteContext) {
  try {
    const { userId, email } = await requireAuth();
    const { itemId } = await params;
    const body = await request.json();

    // Validate input
    const data = updateCanvasItemSchema.parse(body);

    // Verify user has EDIT permission
    await requireItemAccess(itemId, userId, email, "EDIT");

    const itemScope = await prisma.canvasItem.findUnique({
      where: { id: itemId },
      select: { canvasId: true },
    });
    if (!itemScope) throw new NotFoundError("Item not found");
    const updatedItem = await prisma.$transaction(async (tx) => {
      await lockCanvasForMutation(tx, itemScope.canvasId);
      const currentItem = await tx.canvasItem.findUnique({
        where: { id: itemId },
        select: { version: true, deletedAt: true, type: true, canvasId: true },
      });
      if (!currentItem || currentItem.deletedAt)
        throw new NotFoundError("Item not found");
      requirePollsEnabled(currentItem.type);
      const validatedContent =
        data.content !== undefined
          ? parseCanvasItemContent(currentItem.type, data.content)
          : undefined;
      const updateResult = await tx.canvasItem.updateMany({
        where: { id: itemId, version: data.version, deletedAt: null },
        data: {
          ...(data.positionX !== undefined && { positionX: data.positionX }),
          ...(data.positionY !== undefined && { positionY: data.positionY }),
          ...(data.width !== undefined && { width: data.width }),
          ...(data.height !== undefined && { height: data.height }),
          ...(data.zIndex !== undefined && { zIndex: data.zIndex }),
          ...(validatedContent !== undefined && {
            content: validatedContent as Prisma.InputJsonValue,
          }),
          ...(data.tags !== undefined && { tags: data.tags }),
          version: { increment: 1 },
          updatedById: userId,
        },
      });
      if (updateResult.count === 0) {
        const latestItem = await tx.canvasItem.findUnique({
          where: { id: itemId },
          select: { version: true, deletedAt: true },
        });
        if (!latestItem || latestItem.deletedAt)
          throw new NotFoundError("Item not found");
        throw new VersionMismatchError(data.version, latestItem.version);
      }
      const updated = await tx.canvasItem.findUnique({ where: { id: itemId } });
      if (!updated) throw new NotFoundError("Item not found");
      await recordCanvasItemEvent(tx, {
        canvasId: updated.canvasId,
        actorId: userId,
        itemId: updated.id,
        version: updated.version,
        operation: "updated",
      });
      return updated;
    });

    await invalidateCanvasCache(updatedItem.canvasId);

    await logActivity({
      userId,
      type: ActivityType.ITEM_UPDATED,
      canvasId: updatedItem.canvasId,
      itemId: updatedItem.id,
    });

    return NextResponse.json(updatedItem);
  } catch (error) {
    return errorResponse(error, request.url);
  }
}

/**
 * DELETE /api/v1/canvas-items/{itemId}
 * Soft delete a canvas item
 * Phase 3: Requires EDIT permission
 */
export async function DELETE(request: NextRequest, { params }: RouteContext) {
  try {
    const { userId, email } = await requireAuth();
    const { itemId } = await params;
    const body = await request.json();

    // Validate input (requires version for optimistic locking)
    const data = deleteCanvasItemSchema.parse(body);

    // Verify user has EDIT permission
    await requireItemAccess(itemId, userId, email, "EDIT");

    const itemScope = await prisma.canvasItem.findUnique({
      where: { id: itemId },
      select: { canvasId: true },
    });
    if (!itemScope) throw new NotFoundError("Item not found");
    const deletedItem = await prisma.$transaction(async (tx) => {
      await lockCanvasForMutation(tx, itemScope.canvasId);
      const currentItem = await tx.canvasItem.findUnique({
        where: { id: itemId },
        select: { version: true, deletedAt: true, canvasId: true },
      });
      if (!currentItem || currentItem.deletedAt)
        throw new NotFoundError("Item not found");
      const deleteResult = await tx.canvasItem.updateMany({
        where: { id: itemId, version: data.version, deletedAt: null },
        data: {
          deletedAt: new Date(),
          deletedById: userId,
          version: { increment: 1 },
        },
      });
      if (deleteResult.count === 0) {
        const latestItem = await tx.canvasItem.findUnique({
          where: { id: itemId },
          select: { version: true, deletedAt: true },
        });
        if (!latestItem || latestItem.deletedAt)
          throw new NotFoundError("Item not found");
        throw new VersionMismatchError(data.version, latestItem.version);
      }
      const deleted = await tx.canvasItem.findUnique({ where: { id: itemId } });
      if (!deleted) throw new NotFoundError("Item not found");
      await recordCanvasItemEvent(tx, {
        canvasId: deleted.canvasId,
        actorId: userId,
        itemId: deleted.id,
        version: deleted.version,
        operation: "deleted",
      });
      return deleted;
    });

    await invalidateCanvasCache(deletedItem.canvasId);

    await logActivity({
      userId,
      type: ActivityType.ITEM_DELETED,
      canvasId: deletedItem.canvasId,
      itemId,
    });

    return NextResponse.json({ success: true, item: deletedItem });
  } catch (error) {
    return errorResponse(error, request.url);
  }
}
