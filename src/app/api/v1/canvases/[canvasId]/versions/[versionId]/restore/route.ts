/**
 * Restore Canvas Version API
 * Restore canvas to a previous version
 */

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-options';
import { prisma } from '@/lib/db';
import { NotFoundError, UnauthorizedError } from '@/lib/errors';

interface RouteContext {
  params: { canvasId: string; versionId: string };
}

/**
 * POST /api/v1/canvases/[canvasId]/versions/[versionId]/restore
 * Restore canvas to this version
 */
export async function POST(request: NextRequest, { params }: RouteContext) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    throw new UnauthorizedError('You must be logged in');
  }

  const { canvasId, versionId } = params;

  // Verify canvas ownership
  const canvas = await prisma.canvas.findUnique({
    where: { id: canvasId },
  });

  if (!canvas) {
    throw new NotFoundError('Canvas not found');
  }

  if (canvas.userId !== session.user.id) {
    throw new UnauthorizedError('You can only restore your own canvases');
  }

  // Get version
  const version = await prisma.canvasVersion.findUnique({
    where: { id: versionId },
  });

  if (!version || version.canvasId !== canvasId) {
    throw new NotFoundError('Version not found');
  }

  const snapshot = version.snapshot as any;

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
        data: snapshot.items.map((item: any) => ({
          canvasId,
          type: item.type,
          positionX: item.positionX,
          positionY: item.positionY,
          width: item.width,
          height: item.height,
          zIndex: item.zIndex,
          content: item.content,
          tags: item.tags || [],
          createdById: session.user.id,
        })),
      });
    }
  });

  return NextResponse.json({ success: true });
}
