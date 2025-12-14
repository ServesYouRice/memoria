import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db';
// import { createLogger } from '@/lib/logger';

import { withApiHandler } from '@/lib/api/route-handler';
import { notFoundError, forbiddenError, unauthorizedError } from '@/lib/errors';

// const _logger = createLogger('comments-api');

export const GET = withApiHandler(async (_req: NextRequest, { params }: { params: { itemId: string; commentId: string } }) => {
  const session = await auth();
  if (!session?.user?.id) {
    throw unauthorizedError();
  }

  const { commentId } = params;

  const comment = await prisma.comment.findUnique({
    where: { id: commentId },
    include: {
      user: {
        select: {
          id: true,
          name: true,
          image: true,
        },
      },
    },
  });

  if (!comment) {
    throw notFoundError('Comment', commentId);
  }

  // Check access to the item/canvas
  const item = await prisma.canvasItem.findUnique({
    where: { id: comment.itemId },
    include: {
      canvas: {
        include: {
          shares: true,
        },
      },
    },
  });

  if (!item) {
    throw notFoundError('CanvasItem', comment.itemId);
  }

  const hasAccess =
    item.canvas.userId === session.user.id ||
    item.canvas.shares.some((share) => share.email === session.user?.email);

  if (!hasAccess && !item.canvas.isPublic) {
    throw forbiddenError();
  }

  return NextResponse.json(comment);
});
