/**
 * Activities API
 * Fetch user activity feed
 */

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth/auth-options';
import { prisma } from '@/lib/prisma';
import { UnauthorizedError } from '@/lib/errors';

/**
 * GET /api/v1/activities
 * Fetch recent activities for the current user
 */
export async function GET(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    throw new UnauthorizedError('You must be logged in');
  }

  const { searchParams } = new URL(request.url);
  const limit = Math.min(parseInt(searchParams.get('limit') || '50'), 100);
  const canvasId = searchParams.get('canvasId');

  const where: any = {
    userId: session.user.id,
  };

  if (canvasId) {
    where.canvasId = canvasId;
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
}
