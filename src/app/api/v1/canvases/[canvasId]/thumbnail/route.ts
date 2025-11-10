/**
 * Canvas Thumbnail API
 * Update canvas thumbnail preview image
 */

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { prisma } from '@/lib/db';
import { authOptions } from '@/lib/auth';
import { UnauthorizedError, NotFoundError, ValidationError } from '@/lib/errors';

interface RouteContext {
  params: {
    canvasId: string;
  };
}

/**
 * Update canvas thumbnail
 * POST /api/v1/canvases/:canvasId/thumbnail
 */
export async function POST(request: NextRequest, { params }: RouteContext) {
  const session = await getServerSession(authOptions);

  if (!session?.user?.id) {
    throw new UnauthorizedError('You must be logged in');
  }

  const { canvasId } = params;

  // Verify canvas exists and user has access
  const canvas = await prisma.canvas.findUnique({
    where: { id: canvasId },
    select: { userId: true },
  });

  if (!canvas) {
    throw new NotFoundError('Canvas not found');
  }

  if (canvas.userId !== session.user.id) {
    throw new UnauthorizedError('You can only update thumbnails for your own canvases');
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

  return NextResponse.json(updatedCanvas, { status: 200 });
}

/**
 * Delete canvas thumbnail
 * DELETE /api/v1/canvases/:canvasId/thumbnail
 */
export async function DELETE(request: NextRequest, { params }: RouteContext) {
  const session = await getServerSession(authOptions);

  if (!session?.user?.id) {
    throw new UnauthorizedError('You must be logged in');
  }

  const { canvasId } = params;

  // Verify canvas exists and user has access
  const canvas = await prisma.canvas.findUnique({
    where: { id: canvasId },
    select: { userId: true },
  });

  if (!canvas) {
    throw new NotFoundError('Canvas not found');
  }

  if (canvas.userId !== session.user.id) {
    throw new UnauthorizedError('You can only delete thumbnails for your own canvases');
  }

  // Remove thumbnail
  const updatedCanvas = await prisma.canvas.update({
    where: { id: canvasId },
    data: { thumbnail: null },
  });

  return NextResponse.json(updatedCanvas, { status: 200 });
}
