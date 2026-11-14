import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAuth } from "@/lib/api/auth";
import { prisma } from "@/lib/db";
import { ForbiddenError } from "@/lib/errors";
import { invalidateCanvasCache } from "@/lib/cache/canvas-cache";
import { withApiHandler } from "@/lib/api/route-handler";
import { lockCanvasForMutation } from "@/lib/canvas/mutation-lock";
import { assertCanvasCapacity } from "@/lib/policy/capacity";

const paramsSchema = z.object({
  canvasId: z.string().min(1).max(128),
});

interface RouteContext {
  params: Promise<{ canvasId: string }>;
}

/**
 * POST /api/v1/canvases/[canvasId]/restore (IMP-132)
 *
 * Brings the caller's own canvas back from Trash with everything on it. A
 * canvas that is not theirs or not in Trash gets the same answer as one that
 * does not exist.
 */
export const POST = withApiHandler(
  async (_request: Request, { params }: RouteContext) => {
    const { userId } = await requireAuth();
    const { canvasId } = paramsSchema.parse(await params);

    const canvas = await prisma.$transaction(async (tx) => {
      // The sweep takes the same row lock, so it cannot purge the canvas
      // while it is being restored.
      await lockCanvasForMutation(tx, canvasId);
      const trashed = await tx.canvas.findFirst({
        where: { id: canvasId, userId, deletedAt: { not: null } },
        select: { id: true },
      });
      if (!trashed) {
        throw new ForbiddenError("Canvas not found or access denied");
      }
      // A canvas in Trash does not count toward the limit, so bringing one
      // back needs the same check as creating it.
      await assertCanvasCapacity(tx, userId);
      return tx.canvas.update({
        where: { id: canvasId },
        data: { deletedAt: null, deletedById: null },
        select: {
          id: true,
          name: true,
          userId: true,
          workspaceId: true,
          zoomLevel: true,
          panX: true,
          panY: true,
          thumbnailKey: true,
          thumbnailRevision: true,
          isPublic: true,
          shareToken: true,
          deletedAt: true,
          createdAt: true,
          updatedAt: true,
        },
      });
    });

    await invalidateCanvasCache(canvasId);

    return NextResponse.json({
      ...canvas,
      thumbnailRevision: canvas.thumbnailRevision.toString(),
    });
  },
);
