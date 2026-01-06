/**
 * Individual Canvas Share API
 * DELETE /api/v1/canvases/[canvasId]/share/[shareId] - Revoke share
 */

import { type NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { requireAuth } from '@/lib/api/auth';
import { errorResponse, ForbiddenError, NotFoundError } from '@/lib/errors';

interface RouteContext {
  params: Promise<{ canvasId: string; shareId: string }>;
}

/**
 * DELETE - Revoke share
 */
export async function DELETE(request: NextRequest, { params }: RouteContext) {
  try {
    const { userId } = await requireAuth();
    const { canvasId, shareId } = await params;

    // Check if user owns this canvas
    const canvas = await prisma.canvas.findUnique({
      where: { id: canvasId },
    });

    if (!canvas || canvas.userId !== userId) {
      throw new ForbiddenError('You do not have permission to revoke shares for this canvas');
    }

    // Check if share exists
    const share = await prisma.canvasShare.findUnique({
      where: { id: shareId },
    });

    if (!share || share.canvasId !== canvasId) {
      throw new NotFoundError('Share not found');
    }

    // Delete share
    await prisma.canvasShare.delete({
      where: { id: shareId },
    });

    return NextResponse.json({ success: true, message: 'Share revoked successfully' });
  } catch (error) {
    return errorResponse(error, request.url);
  }
}
