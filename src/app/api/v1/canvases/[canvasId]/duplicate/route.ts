/**
 * Canvas Duplication API
 * Clone an existing canvas with all items
 */

import { type NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/api/auth';
import { prisma } from '@/lib/db';
import { NotFoundError, ForbiddenError, errorResponse } from '@/lib/errors';
import { runIdempotent } from '@/lib/api/route-handler';

interface RouteContext {
  params: Promise<{ canvasId: string }>;
}

/**
 * POST /api/v1/canvases/[canvasId]/duplicate
 * Duplicate a canvas
 */
export async function POST(request: NextRequest, { params }: RouteContext) {
  try {
    const { userId } = await requireAuth();
    const { canvasId } = await params;

    return await runIdempotent(request, userId, async () => {
      // Get original canvas
      const original = await prisma.canvas.findUnique({
        where: { id: canvasId },
        include: {
          items: {
            where: { deletedAt: null },
          },
        },
      });

      if (!original) {
        throw new NotFoundError('Canvas not found');
      }

      if (original.userId !== userId) {
        throw new ForbiddenError('You can only duplicate your own canvases');
      }

      // Create duplicate
      const duplicate = await prisma.canvas.create({
        data: {
          name: `${original.name} (Copy)`,
          userId,
          zoomLevel: original.zoomLevel,
          panX: original.panX,
          panY: original.panY,
          items: {
            create: original.items.map((item) => ({
              type: item.type,
              positionX: item.positionX,
              positionY: item.positionY,
              width: item.width,
              height: item.height,
              zIndex: item.zIndex,
              content: item.content as any,
              tags: item.tags,
              createdById: userId,
            })),
          },
        },
        include: {
          items: true,
        },
      });

      return NextResponse.json(duplicate, { status: 201 });
    });
  } catch (error) {
    return errorResponse(error, request.url);
  }
}
