/**
 * Public Canvas Sharing API
 * POST /api/v1/canvases/[canvasId]/public - Make canvas public and generate share link
 * DELETE /api/v1/canvases/[canvasId]/public - Make canvas private
 */

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { requireAuth } from '@/lib/api/auth';
import { errorResponse, ForbiddenError } from '@/lib/errors';
import { nanoid } from 'nanoid';

interface RouteContext {
  params: Promise<{ canvasId: string }>;
}

/**
 * POST - Make canvas public and generate share link
 */
export async function POST(request: NextRequest, { params }: RouteContext) {
  try {
    const { userId } = await requireAuth();
    const { canvasId } = await params;

    // Check if user owns this canvas
    const canvas = await prisma.canvas.findUnique({
      where: { id: canvasId },
    });

    if (!canvas || canvas.userId !== userId) {
      throw new ForbiddenError('You do not have permission to make this canvas public');
    }

    // Generate share token if not exists
    const shareToken = canvas.shareToken || nanoid(16);

    // Update canvas to be public
    const updatedCanvas = await prisma.canvas.update({
      where: { id: canvasId },
      data: {
        isPublic: true,
        shareToken,
      },
    });

    // Generate share URL
    const shareUrl = `${process.env.NEXTAUTH_URL || 'http://localhost:3000'}/share/${shareToken}`;

    return NextResponse.json({
      shareToken: updatedCanvas.shareToken,
      shareUrl,
      isPublic: updatedCanvas.isPublic,
    });
  } catch (error) {
    return errorResponse(error, request.url);
  }
}

/**
 * DELETE - Make canvas private
 */
export async function DELETE(request: NextRequest, { params }: RouteContext) {
  try {
    const { userId } = await requireAuth();
    const { canvasId } = await params;

    // Check if user owns this canvas
    const canvas = await prisma.canvas.findUnique({
      where: { id: canvasId },
    });

    if (!canvas || canvas.userId !== userId) {
      throw new ForbiddenError('You do not have permission to make this canvas private');
    }

    // Update canvas to be private (keep shareToken for potential re-enable)
    const updatedCanvas = await prisma.canvas.update({
      where: { id: canvasId },
      data: {
        isPublic: false,
      },
    });

    return NextResponse.json({
      isPublic: updatedCanvas.isPublic,
      message: 'Canvas is now private',
    });
  } catch (error) {
    return errorResponse(error, request.url);
  }
}
