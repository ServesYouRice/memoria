/**
 * Restore Canvas Version API
 * Restore canvas to a previous version
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/api/auth';
import { prisma } from '@/lib/db';
import { NotFoundError, ForbiddenError, errorResponse } from '@/lib/errors';
import { invalidateCanvasCache } from '@/lib/cache/canvas-cache';

interface RouteContext {
  params: Promise<{ canvasId: string; versionId: string }>;
}

interface SnapshotItem {
  type: string;
  positionX: number;
  positionY: number;
  width: number;
  height: number;
  zIndex: number;
  content: unknown;
  tags?: string[];
}

interface Snapshot {
  name?: string;
  zoomLevel?: number;
  panX?: number;
  panY?: number;
  items?: SnapshotItem[];
}

/**
 * POST /api/v1/canvases/[canvasId]/versions/[versionId]/restore
 * Restore canvas to this version
 */
export async function POST(request: NextRequest, { params }: RouteContext) {
  try {
    const { userId } = await requireAuth();
    const { canvasId, versionId } = await params;

    // Verify canvas ownership
    const canvas = await prisma.canvas.findUnique({
      where: { id: canvasId },
    });

    if (!canvas) {
      throw new NotFoundError('Canvas not found');
    }

    if (canvas.userId !== userId) {
      throw new ForbiddenError('You can only restore your own canvases');
    }

    // Get version
    const version = await prisma.canvasVersion.findUnique({
      where: { id: versionId },
    });

    if (!version || version.canvasId !== canvasId) {
      throw new NotFoundError('Version not found');
    }

    const snapshot = version.snapshot as Snapshot;

    // Perform restore in a transaction
    await prisma.$transaction(async (tx) => {
      // Delete all current items
      await tx.canvasItem.deleteMany({
        where: { canvasId },
      });

      // Restore canvas settings
      await tx.canvas.update({
        where: { id: canvasId },
        data: {
          name: snapshot.name || canvas.name,
          zoomLevel: snapshot.zoomLevel || 1.0,
          panX: snapshot.panX || 0,
          panY: snapshot.panY || 0,
        },
      });

      // Restore items
      if (snapshot.items && Array.isArray(snapshot.items)) {
        await tx.canvasItem.createMany({
          data: snapshot.items.map((item) => ({
            canvasId,
            type: item.type as any,
            positionX: item.positionX,
            positionY: item.positionY,
            width: item.width,
            height: item.height,
            zIndex: item.zIndex,
            content: item.content as any,
            tags: item.tags || [],
            createdById: userId,
          })),
        });
      }
    });

    await invalidateCanvasCache(canvasId);

    return NextResponse.json({ success: true });
  } catch (error) {
    return errorResponse(error, request.url);
  }
}
