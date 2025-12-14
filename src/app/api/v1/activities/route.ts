/**
 * Activities API
 * Fetch user activity feed
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/api/auth';
import { prisma } from '@/lib/db';
import { errorResponse } from '@/lib/errors';

/**
 * GET /api/v1/activities
 * Fetch recent activities for the current user
 */
export async function GET(request: NextRequest) {
  try {
    const { userId } = await requireAuth();

    const { searchParams } = new URL(request.url);
    const limit = Math.min(parseInt(searchParams.get('limit') || '50'), 100);
    const canvasId = searchParams.get('canvasId');

    const where: Record<string, unknown> = {
      userId,
    };

    if (canvasId) {
      where['canvasId'] = canvasId;
    }

    const activities = await prisma.activity.findMany({
      where,
      orderBy: {
        createdAt: 'desc',
      },
      take: limit,
      include: {
        user: {
          select: {
            id: true,
            name: true,
            email: true,
            image: true,
          },
        },
      },
    });

    return NextResponse.json({ activities });
  } catch (error) {
    return errorResponse(error, request.url);
  }
}
