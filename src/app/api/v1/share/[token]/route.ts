/**
 * Public Share API
 * GET /api/v1/share/[token] - Get publicly shared canvas (no auth required)
 */

import { type NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { errorResponse, NotFoundError, ForbiddenError } from '@/lib/errors';

interface RouteContext {
  params: Promise<{ token: string }>;
}

/**
 * GET - Get publicly shared canvas
 * No authentication required
 */
export async function GET(request: NextRequest, { params }: RouteContext) {
  try {
    const { token } = await params;

    // Find canvas by share token
    const canvas = await prisma.canvas.findUnique({
      where: { shareToken: token },
      include: {
        items: {
          where: { deletedAt: null },
          orderBy: [{ zIndex: 'asc' }, { createdAt: 'asc' }],
        },
        user: {
          select: {
            name: true,
            email: false, // Don't expose email
          },
        },
      },
    });

    if (!canvas) {
      throw new NotFoundError('Canvas not found');
    }

    // Check if canvas is public
    if (!canvas.isPublic) {
      throw new ForbiddenError('This canvas is not publicly shared');
    }

    // Return canvas data
    return NextResponse.json({
      id: canvas.id,
      name: canvas.name,
      owner: canvas.user.name || 'Anonymous',
      items: canvas.items,
      zoomLevel: canvas.zoomLevel,
      panX: canvas.panX,
      panY: canvas.panY,
    });
  } catch (error) {
    return errorResponse(error, request.url);
  }
}
