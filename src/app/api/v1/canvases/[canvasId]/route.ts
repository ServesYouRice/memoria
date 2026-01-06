import { NextResponse } from 'next/server';
import { requireAuth, requireCanvasOwnership, requireCanvasAccess } from '@/lib/api/auth';
import { prisma } from '@/lib/db';
import { z } from 'zod';
import { NotFoundError } from '@/lib/errors';
import { getCachedCanvas, setCachedCanvas, invalidateCanvasCache } from '@/lib/cache/canvas-cache';
import { withApiHandler } from '@/lib/api/route-handler';

const updateCanvasSchema = z.object({
  name: z.string().min(1).max(255).optional(),
  zoomLevel: z.number().min(0.1).max(5).optional(),
  panX: z.number().optional(),
  panY: z.number().optional(),
  workspaceId: z.string().cuid().nullable().optional(),
});

export const GET = withApiHandler(async (
  _request: Request,
  { params }: { params: { canvasId: string } }
) => {
  const { userId, email } = await requireAuth();
  const { canvasId } = params;

  // Verify canvas access (ownership or share)
  await requireCanvasAccess(canvasId, userId, email, 'VIEW');

  // 1. Try to get canvas data (canvas + items) from cache
  let canvasData = await getCachedCanvas(canvasId);

  if (!canvasData) {
    // 2. Cache miss: Fetch from database (global state only)
    const data = await prisma.canvas.findUnique({
      where: { id: canvasId },
      include: {
        items: {
          where: { deletedAt: null },
          orderBy: { zIndex: 'asc' },
        },
        // Do NOT include user-specific shares here as they are dynamic
      },
    });

    if (!data) {
      throw new NotFoundError('Canvas not found');
    }

    canvasData = data;

    // 3. Store in cache
    await setCachedCanvas(canvasData);
  }

  // 4. Fetch user-specific share info (always fresh)
  const shares = await prisma.canvasShare.findMany({
    where: {
      canvasId,
      email,
    },
    select: {
      id: true,
      role: true,
      createdAt: true,
    },
  });

  // 5. Return combined response
  return NextResponse.json({
    ...canvasData,
    shares,
  });
});

export const PATCH = withApiHandler(async (
  request: Request,
  { params }: { params: { canvasId: string } }
) => {
  const { userId } = await requireAuth();
  const { canvasId } = params;

  // Verify canvas ownership
  await requireCanvasOwnership(canvasId, userId);

  // Parse and validate request body
  const body = await request.json();
  const validatedData = updateCanvasSchema.parse(body);

  // Update canvas
  const updatedCanvas = await prisma.canvas.update({
    where: { id: canvasId },
    data: validatedData,
  });

  // Invalidate cache
  await invalidateCanvasCache(canvasId);

  return NextResponse.json(updatedCanvas);
});

export const DELETE = withApiHandler(async (
  _request: Request,
  { params }: { params: { canvasId: string } }
) => {
  const { userId } = await requireAuth();
  const { canvasId } = params;

  // Verify canvas ownership
  await requireCanvasOwnership(canvasId, userId);

  // Delete canvas (cascade will delete items, shares, etc.)
  await prisma.canvas.delete({
    where: { id: canvasId },
  });

  // Invalidate cache
  await invalidateCanvasCache(canvasId);

  return NextResponse.json(
    { message: 'Canvas deleted successfully' },
    { status: 200 }
  );
});
