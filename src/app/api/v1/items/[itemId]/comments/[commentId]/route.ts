/**
 * Individual Comment API
 * Handles updating and deleting specific comments
 */

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth/auth-options';
import { prisma } from '@/lib/prisma';
import { z } from 'zod';
import { NotFoundError, UnauthorizedError, ValidationError } from '@/lib/errors';

interface RouteContext {
  params: { itemId: string; commentId: string };
}

const updateCommentSchema = z.object({
  content: z.string().min(1, 'Comment cannot be empty').max(5000, 'Comment too long'),
});

/**
 * PATCH /api/v1/items/[itemId]/comments/[commentId]
 * Update a comment (only by comment author)
 */
export async function PATCH(request: NextRequest, { params }: RouteContext) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    throw new UnauthorizedError('You must be logged in to update comments');
  }

  const { commentId } = params;

  // Validate request body
  const body = await request.json();
  const validation = updateCommentSchema.safeParse(body);
  if (!validation.success) {
    throw new ValidationError(validation.error.errors[0].message);
  }

  const { content } = validation.data;

  // Find comment and check ownership
  const comment = await prisma.comment.findUnique({
    where: { id: commentId },
    include: {
      user: true,
    },
  });

  if (!comment || comment.deletedAt) {
    throw new NotFoundError('Comment not found');
  }

  if (comment.userId !== session.user.id) {
    throw new UnauthorizedError('You can only edit your own comments');
  }

  // Update the comment
  const updatedComment = await prisma.comment.update({
    where: { id: commentId },
    data: { content },
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

  return NextResponse.json(updatedComment);
}

/**
 * DELETE /api/v1/items/[itemId]/comments/[commentId]
 * Delete a comment (soft delete)
 */
export async function DELETE(request: NextRequest, { params }: RouteContext) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    throw new UnauthorizedError('You must be logged in to delete comments');
  }

  const { commentId } = params;

  // Find comment and check ownership
  const comment = await prisma.comment.findUnique({
    where: { id: commentId },
    include: {
      item: {
        include: {
          canvas: true,
        },
      },
    },
  });

  if (!comment || comment.deletedAt) {
    throw new NotFoundError('Comment not found');
  }

  // Allow deletion by comment author or canvas owner
  const isCommentAuthor = comment.userId === session.user.id;
  const isCanvasOwner = comment.item.canvas.userId === session.user.id;

  if (!isCommentAuthor && !isCanvasOwner) {
    throw new UnauthorizedError('You can only delete your own comments or comments on your canvas');
  }

  // Soft delete the comment
  await prisma.comment.update({
    where: { id: commentId },
    data: { deletedAt: new Date() },
  });

  return NextResponse.json({ success: true }, { status: 200 });
}
