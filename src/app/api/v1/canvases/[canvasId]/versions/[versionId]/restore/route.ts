/**
 * Restore Canvas Version API
 * Restore canvas to a previous version
 */

import { type NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/api/auth';
import { prisma } from '@/lib/db';
import { NotFoundError, ForbiddenError, errorResponse } from '@/lib/errors';
import { invalidateCanvasCache } from '@/lib/cache/canvas-cache';

interface RouteContext {
  params: Promise<{ canvasId: string; versionId: string }>;
}

interface SnapshotItem {
  id?: string;
  type: string;
  positionX: number;
  positionY: number;
  width: number;
  height: number;
  zIndex: number;
  content: unknown;
  tags?: string[];
  version?: number;
  createdById?: string;
  updatedById?: string | null;
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
    const snapshotItems = Array.isArray(snapshot.items) ? snapshot.items : [];
    const hasLegacyItems = snapshotItems.some((item) => !item.id);

    // Perform restore in a transaction
    await prisma.$transaction(async (tx) => {
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

      if (snapshotItems.length === 0) {
        await tx.canvasItem.updateMany({
          where: { canvasId, deletedAt: null },
          data: {
            deletedAt: new Date(),
            deletedById: userId,
            updatedById: userId,
          },
        });
        return;
      }

      if (hasLegacyItems) {
        await tx.canvasItem.deleteMany({
          where: { canvasId },
        });

        await tx.canvasItem.createMany({
          data: snapshotItems.map((item) => ({
            canvasId,
            type: item.type as any,
            positionX: item.positionX,
            positionY: item.positionY,
            width: item.width,
            height: item.height,
            zIndex: item.zIndex,
            content: item.content as any,
            tags: item.tags || [],
            version: item.version ?? 1,
            createdById: item.createdById || userId,
            updatedById: item.updatedById || userId,
          })),
        });
        return;
      }

      const snapshotIds = snapshotItems.map((item) => item.id as string);

      await tx.canvasItem.updateMany({
        where: {
          canvasId,
          id: { notIn: snapshotIds },
          deletedAt: null,
        },
        data: {
          deletedAt: new Date(),
          deletedById: userId,
          updatedById: userId,
        },
      });

      for (const item of snapshotItems) {
        await tx.canvasItem.upsert({
          where: { id: item.id as string },
          update: {
            type: item.type as any,
            positionX: item.positionX,
            positionY: item.positionY,
            width: item.width,
            height: item.height,
            zIndex: item.zIndex,
            content: item.content as any,
            tags: item.tags || [],
            deletedAt: null,
            deletedById: null,
            updatedById: userId,
            version: item.version ?? 1,
          },
          create: {
            id: item.id as string,
            canvasId,
            type: item.type as any,
            positionX: item.positionX,
            positionY: item.positionY,
            width: item.width,
            height: item.height,
            zIndex: item.zIndex,
            content: item.content as any,
            tags: item.tags || [],
            version: item.version ?? 1,
            createdById: item.createdById || userId,
            updatedById: userId,
          },
        });
      }
    });

    await invalidateCanvasCache(canvasId);

    return NextResponse.json({ success: true });
  } catch (error) {
    return errorResponse(error, request.url);
  }
}
