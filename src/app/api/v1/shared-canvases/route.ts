/**
 * Shared Canvases API
 * GET /api/v1/shared-canvases - List canvases shared with the current user
 */

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { requireAuth } from '@/lib/api/auth';
import { errorResponse } from '@/lib/errors';

/**
 * GET - List canvases shared with the current user
 */
export async function GET(request: NextRequest) {
  try {
    const { email } = await requireAuth();

    // Find all shares for this user's email
    const shares = await prisma.canvasShare.findMany({
      where: {
        email: email.toLowerCase(),
      },
      include: {
        canvas: {
          include: {
            user: {
              select: {
                name: true,
                email: true,
              },
            },
            _count: {
              select: {
                items: {
                  where: {
                    deletedAt: null,
                  },
                },
              },
            },
          },
        },
      },
      orderBy: {
        createdAt: 'desc',
      },
    });

    // Transform to include role and owner info
    const sharedCanvases = shares.map((share) => ({
      id: share.canvas.id,
      name: share.canvas.name,
      thumbnail: share.canvas.thumbnail,
      itemCount: share.canvas._count.items,
      owner: share.canvas.user,
      role: share.role,
      sharedAt: share.createdAt,
      updatedAt: share.canvas.updatedAt,
    }));

    return NextResponse.json({ canvases: sharedCanvases });
  } catch (error) {
    return errorResponse(error, request.url);
  }
}
