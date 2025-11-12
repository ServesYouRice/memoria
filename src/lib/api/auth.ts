/**
 * API Authentication & Authorization
 * Following ADR-0008: Auth, Session & CSRF Policy
 */

import { getServerSession } from 'next-auth';
import { prisma } from '@/lib/db';
import { UnauthorizedError, ForbiddenError } from '@/lib/errors';

/**
 * Get authenticated user from session
 * Throws UnauthorizedError if not authenticated
 */
export async function requireAuth() {
  const session = await getServerSession();

  if (!session || !session.user?.email || !session.user?.id) {
    throw new UnauthorizedError('You must be logged in to access this resource');
  }

  return {
    userId: session.user.id,
    email: session.user.email,
  };
}

/**
 * Verify user owns the canvas
 * Following security policy: all data-access APIs must perform ownership checks
 */
export async function requireCanvasOwnership(canvasId: string, userId: string) {
  const canvas = await prisma.canvas.findUnique({
    where: { id: canvasId },
    select: { userId: true },
  });

  if (!canvas) {
    throw new ForbiddenError('Canvas not found or access denied');
  }

  if (canvas.userId !== userId) {
    throw new ForbiddenError('You do not have permission to access this canvas');
  }

  return canvas;
}

/**
 * Verify user owns the canvas item (via canvas ownership)
 */
export async function requireItemOwnership(itemId: string, userId: string) {
  const item = await prisma.canvasItem.findUnique({
    where: { id: itemId },
    select: {
      id: true,
      canvas: {
        select: { userId: true },
      },
    },
  });

  if (!item) {
    throw new ForbiddenError('Item not found or access denied');
  }

  if (item.canvas.userId !== userId) {
    throw new ForbiddenError('You do not have permission to access this item');
  }

  return item;
}
