import { NextResponse } from 'next/server';
import { requireAuth, requireCanvasOwnership, requireCanvasAccess } from '@/lib/api/auth';
import { prisma } from '@/lib/db';
import { logger } from '@/lib/logger';
import { z } from 'zod';
import { NotFoundError, ForbiddenError } from '@/lib/errors';
import { errorResponse } from '@/lib/api/error-handler';

const updateCanvasSchema = z.object({
  name: z.string().min(1).max(255).optional(),
  zoomLevel: z.number().min(0.1).max(5).optional(),
  panX: z.number().optional(),
  panY: z.number().optional(),
});

/**
 * GET /api/v1/canvases/[canvasId]
 *
 * Retrieve a single canvas by ID
 * User must own the canvas or have shared access
 */
export async function GET(
  request: Request,
  { params }: { params: { canvasId: string } }
) {
  try {
    const { userId, email } = await requireAuth();
    const { canvasId } = params;

    // Verify canvas access (ownership or share)
    await requireCanvasAccess(canvasId, userId, email, 'VIEW');

    // Fetch canvas with items
    const canvas = await prisma.canvas.findUnique({
      where: { id: canvasId },
      include: {
        items: {
          where: { deletedAt: null },
          orderBy: { zIndex: 'asc' },
        },
        shares: {
          where: { email },
          select: {
            id: true,
            role: true,
            createdAt: true,
          },
        },
      },
    });

    if (!canvas) {
      throw new NotFoundError('Canvas not found');
    }

    return NextResponse.json(canvas);
  } catch (error) {
    return errorResponse(error, request.url);
  }
}

/**
 * PATCH /api/v1/canvases/[canvasId]
 *
 * Update canvas properties (name, zoom, pan)
 * Per ADR-0001: API Versioning & Error Contract (RFC 7807)
 */
export async function PATCH(
  request: Request,
  { params }: { params: { canvasId: string } }
) {
  try {
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

    return NextResponse.json(updatedCanvas);
  } catch (error) {
    return errorResponse(error, request.url);
  }
}

/**
 * DELETE /api/v1/canvases/[canvasId]
 *
 * Delete a canvas and all associated items
 * Only the canvas owner can delete it
 */
export async function DELETE(
  request: Request,
  { params }: { params: { canvasId: string } }
) {
  try {
    const { userId } = await requireAuth();
    const { canvasId } = params;

    // Verify canvas ownership
    await requireCanvasOwnership(canvasId, userId);

    // Delete canvas (cascade will delete items, shares, etc.)
    await prisma.canvas.delete({
      where: { id: canvasId },
    });

    return NextResponse.json(
      { message: 'Canvas deleted successfully' },
      { status: 200 }
    );
  } catch (error) {
    return errorResponse(error, request.url);
  }
}
