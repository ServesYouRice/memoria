import { type NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { requireAuth, requireItemOwnership } from "@/lib/api/auth";
import { parsePagination } from "@/lib/api/pagination";
import { ConflictError, errorResponse } from "@/lib/errors";
import { invalidateCanvasCache } from "@/lib/cache/canvas-cache";
import { lockCanvasForMutation } from "@/lib/canvas/mutation-lock";
import { assertCanvasItemCapacity } from "@/lib/policy/capacity";
import { recordCanvasItemEvent } from "@/lib/collaboration/committed-events";

const restoreSchema = z
  .object({
    itemId: z.string().cuid(),
    version: z.number().int().positive(),
  })
  .strict();

export async function GET(request: NextRequest) {
  try {
    const { userId } = await requireAuth();
    const { limit, offset } = parsePagination(request.nextUrl.searchParams, {
      defaultLimit: 50,
      maxLimit: 100,
    });
    const where = { deletedAt: { not: null }, canvas: { userId } };
    const [items, total] = await prisma.$transaction([
      prisma.canvasItem.findMany({
        where,
        orderBy: { deletedAt: "desc" },
        take: limit,
        skip: offset,
        select: {
          id: true,
          type: true,
          content: true,
          version: true,
          deletedAt: true,
          archivedAt: true,
          canvas: { select: { id: true, name: true } },
        },
      }),
      prisma.canvasItem.count({ where }),
    ]);
    return NextResponse.json({
      items,
      pagination: {
        limit,
        offset,
        total,
        hasMore: offset + items.length < total,
      },
    });
  } catch (error) {
    return errorResponse(error, request.url);
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const { userId } = await requireAuth();
    const data = restoreSchema.parse(await request.json());
    const item = await requireItemOwnership(data.itemId, userId);
    const result = await prisma.$transaction(async (tx) => {
      await lockCanvasForMutation(tx, item.canvasId);
      // Trashed items do not count toward the per-canvas limit, so bringing
      // one back needs the same capacity check as creating it.
      await assertCanvasItemCapacity(tx, item.canvasId, 1);
      const restored = await tx.canvasItem.updateMany({
        where: {
          id: data.itemId,
          version: data.version,
          deletedAt: { not: null },
        },
        data: {
          deletedAt: null,
          deletedById: null,
          archivedAt: null,
          version: { increment: 1 },
          updatedById: userId,
        },
      });
      // Open canvases (and their collaborative documents) pick the item up.
      if (restored.count === 1)
        await recordCanvasItemEvent(tx, {
          canvasId: item.canvasId,
          actorId: userId,
          itemId: data.itemId,
          version: data.version + 1,
          operation: "created",
        });
      return restored;
    });
    if (result.count !== 1)
      throw new ConflictError("Item changed before it could be restored");
    await invalidateCanvasCache(item.canvasId);
    return NextResponse.json({ restored: true });
  } catch (error) {
    return errorResponse(error, request.url);
  }
}
