/**
 * Canvas Thumbnail API
 * Update canvas thumbnail preview image
 */

import { type NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/api/auth';
import { prisma } from '@/lib/db';
import { NotFoundError, ForbiddenError, ValidationError, errorResponse } from '@/lib/errors';
import { invalidateCanvasCache } from '@/lib/cache/canvas-cache';

interface RouteContext {
  params: Promise<{ canvasId: string }>;
}

/**
 * Update canvas thumbnail
 * POST /api/v1/canvases/:canvasId/thumbnail
 */
export async function POST(request: NextRequest, { params }: RouteContext) {
  try {
    const { userId } = await requireAuth();
    const { canvasId } = await params;

    // Verify canvas exists and user has access
    const canvas = await prisma.canvas.findUnique({
      where: { id: canvasId },
      select: { userId: true },
    });

    if (!canvas) {
      throw new NotFoundError('Canvas not found');
    }

    if (canvas.userId !== userId) {
      throw new ForbiddenError('You can only update thumbnails for your own canvases');
    }

    const body = await request.json();
    const { thumbnail } = body;

    if (!thumbnail || typeof thumbnail !== 'string') {
      throw new ValidationError('Thumbnail data is required');
    }

    // Validate that it's a data URL
    if (!thumbnail.startsWith('data:image/')) {
      throw new ValidationError('Thumbnail must be a valid image data URL');
    }

    // Update canvas with thumbnail
    const updatedCanvas = await prisma.canvas.update({
      where: { id: canvasId },
      data: { thumbnail },
    });

    await invalidateCanvasCache(canvasId);

    return NextResponse.json(updatedCanvas, { status: 200 });
  } catch (error) {
    return errorResponse(error, request.url);
  }
}

/**
 * Delete canvas thumbnail
 * DELETE /api/v1/canvases/:canvasId/thumbnail
 */
export async function DELETE(request: NextRequest, { params }: RouteContext) {
  try {
    const { userId } = await requireAuth();
    const { canvasId } = await params;

    // Verify canvas exists and user has access
    const canvas = await prisma.canvas.findUnique({
      where: { id: canvasId },
      select: { userId: true },
    });

    if (!canvas) {
      throw new NotFoundError('Canvas not found');
    }

    if (canvas.userId !== userId) {
      throw new ForbiddenError('You can only delete thumbnails for your own canvases');
    }

    // Remove thumbnail
    const updatedCanvas = await prisma.canvas.update({
      where: { id: canvasId },
      data: { thumbnail: null },
    });

    await invalidateCanvasCache(canvasId);

    return NextResponse.json(updatedCanvas, { status: 200 });
  } catch (error) {
    return errorResponse(error, request.url);
  }
}
