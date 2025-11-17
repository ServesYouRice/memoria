/**
 * Canvas Duplication API
 * Clone an existing canvas with all items
 */

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-options';
import { prisma } from '@/lib/db';
import { NotFoundError, UnauthorizedError } from '@/lib/errors';

interface RouteContext {
  params: { canvasId: string };
}

/**
 * POST /api/v1/canvases/[canvasId]/duplicate
 * Duplicate a canvas
 */
export async function POST(request: NextRequest, { params }: RouteContext) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    throw new UnauthorizedError('You must be logged in');
  }

  const { canvasId } = params;

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

  if (original.userId !== session.user.id) {
    throw new UnauthorizedError('You can only duplicate your own canvases');
  }

  // Create duplicate
  const duplicate = await prisma.canvas.create({
    data: {
      name: `${original.name} (Copy)`,
      userId: session.user.id,
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
          content: item.content,
          tags: item.tags,
          createdById: session.user.id,
        })),
      },
    },
    include: {
      items: true,
    },
  });

  return NextResponse.json(duplicate, { status: 201 });
}
