/**
 * Canvas Item API Routes (Individual Item)
 * GET /api/v1/canvas-items/{itemId} - Get a specific item
 * PATCH /api/v1/canvas-items/{itemId} - Update an item (with optimistic locking)
 * DELETE /api/v1/canvas-items/{itemId} - Soft delete an item
 *
 * Following ADR-0009: Optimistic Concurrency Control
 */

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { requireAuth, requireItemOwnership } from '@/lib/api/auth';
import { errorResponse, NotFoundError, VersionMismatchError } from '@/lib/errors';
import { updateCanvasItemSchema, deleteCanvasItemSchema } from '@/lib/validation/canvas-item';

interface RouteContext {
  params: { itemId: string };
}

/**
 * GET /api/v1/canvas-items/{itemId}
 * Get a specific canvas item
 */
export async function GET(request: NextRequest, { params }: RouteContext) {
  try {
    const { userId } = await requireAuth();
    const { itemId } = params;

    // Verify ownership
    await requireItemOwnership(itemId, userId);

    // Fetch item
    const item = await prisma.canvasItem.findUnique({
      where: { id: itemId },
    });

    if (!item || item.deletedAt) {
      throw new NotFoundError('Item not found');
    }

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
 */
export async function PATCH(request: NextRequest, { params }: RouteContext) {
  try {
    const { userId } = await requireAuth();
    const { itemId } = params;
    const body = await request.json();

    // Validate input
    const data = updateCanvasItemSchema.parse(body);

    // Verify ownership
    await requireItemOwnership(itemId, userId);

    // Get current item to check version
    const currentItem = await prisma.canvasItem.findUnique({
      where: { id: itemId },
      select: { version: true, deletedAt: true },
    });

    if (!currentItem || currentItem.deletedAt) {
      throw new NotFoundError('Item not found');
    }

    if (currentItem.version !== data.version) {
      throw new VersionMismatchError(data.version, currentItem.version);
    }

    // Update with version increment
    const updatedItem = await prisma.canvasItem.update({
      where: {
        id: itemId,
        version: data.version, // Optimistic lock
      },
      data: {
        ...(data.positionX !== undefined && { positionX: data.positionX }),
        ...(data.positionY !== undefined && { positionY: data.positionY }),
        ...(data.width !== undefined && { width: data.width }),
        ...(data.height !== undefined && { height: data.height }),
        ...(data.zIndex !== undefined && { zIndex: data.zIndex }),
        ...(data.content !== undefined && { content: data.content as any }),
        ...(data.tags !== undefined && { tags: data.tags }),
        version: { increment: 1 },
        updatedById: userId,
      },
    });

    return NextResponse.json(updatedItem);
  } catch (error) {
    return errorResponse(error, request.url);
  }
}

/**
 * DELETE /api/v1/canvas-items/{itemId}
 * Soft delete a canvas item
 */
export async function DELETE(request: NextRequest, { params }: RouteContext) {
  try {
    const { userId } = await requireAuth();
    const { itemId } = params;
    const body = await request.json();

    // Validate input (requires version for optimistic locking)
    const data = deleteCanvasItemSchema.parse(body);

    // Verify ownership
    await requireItemOwnership(itemId, userId);

    // Get current item to check version
    const currentItem = await prisma.canvasItem.findUnique({
      where: { id: itemId },
      select: { version: true, deletedAt: true },
    });

    if (!currentItem || currentItem.deletedAt) {
      throw new NotFoundError('Item not found');
    }

    if (currentItem.version !== data.version) {
      throw new VersionMismatchError(data.version, currentItem.version);
    }

    // Soft delete
    const deletedItem = await prisma.canvasItem.update({
      where: {
        id: itemId,
        version: data.version, // Optimistic lock
      },
      data: {
        deletedAt: new Date(),
        deletedById: userId,
        version: { increment: 1 },
      },
    });

    return NextResponse.json({ success: true, item: deletedItem });
  } catch (error) {
    return errorResponse(error, request.url);
  }
}
