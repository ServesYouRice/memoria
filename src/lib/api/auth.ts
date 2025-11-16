/**
 * API Authentication & Authorization
 *
 * ENHANCED: Issue #25 - Session caching to avoid repeated DB calls
 *
 * Following ADR-0008: Auth, Session & CSRF Policy
 * Phase 3: Includes shared canvas authorization
 */

import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { UnauthorizedError, ForbiddenError } from '@/lib/errors';

/**
 * Get authenticated user from session
 * Throws UnauthorizedError if not authenticated
 *
 * NOTE: For better performance in routes with multiple auth checks,
 * consider using getCachedSession() from '@/lib/api/session-cache'
 * to avoid repeated database queries within the same request.
 */
export async function requireAuth() {
  const session = await auth();

  if (!session || !session.user?.email || !session.user?.id) {
    throw new UnauthorizedError('You must be logged in to access this resource');
  }

  return {
    userId: session.user.id,
    email: session.user.email,
  };
}

/**
 * Canvas access levels based on ownership and shares
 */
export type CanvasAccessLevel = 'OWNER' | 'EDIT' | 'COMMENT' | 'VIEW' | 'NONE';

/**
 * Get user's access level for a canvas
 * Returns access level based on ownership or share permission
 */
export async function getCanvasAccess(canvasId: string, userId: string, userEmail: string): Promise<CanvasAccessLevel> {
  const canvas = await prisma.canvas.findUnique({
    where: { id: canvasId },
    select: {
      userId: true,
      shares: {
        where: { email: userEmail.toLowerCase() },
        select: { role: true },
      },
    },
  });

  if (!canvas) {
    return 'NONE';
  }

  // Owner has full access
  if (canvas.userId === userId) {
    return 'OWNER';
  }

  // Check if user has shared access
  if (canvas.shares.length > 0) {
    return canvas.shares[0].role as CanvasAccessLevel;
  }

  return 'NONE';
}

/**
 * Require minimum access level for a canvas
 * Throws ForbiddenError if user doesn't have required access
 */
export async function requireCanvasAccess(
  canvasId: string,
  userId: string,
  userEmail: string,
  requiredLevel: 'VIEW' | 'COMMENT' | 'EDIT' | 'OWNER'
): Promise<CanvasAccessLevel> {
  const access = await getCanvasAccess(canvasId, userId, userEmail);

  // Define access hierarchy
  const accessHierarchy: Record<CanvasAccessLevel, number> = {
    OWNER: 4,
    EDIT: 3,
    COMMENT: 2,
    VIEW: 1,
    NONE: 0,
  };

  const userAccessLevel = accessHierarchy[access];
  const requiredAccessLevel = accessHierarchy[requiredLevel];

  if (userAccessLevel < requiredAccessLevel) {
    throw new ForbiddenError('You do not have sufficient permissions to perform this action');
  }

  return access;
}

/**
 * Verify user owns the canvas
 * Following security policy: all data-access APIs must perform ownership checks
 * NOTE: Use requireCanvasAccess for share-aware permission checking
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
 * NOTE: Use requireItemAccess for share-aware permission checking
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

/**
 * Require minimum access level for a canvas item
 * Checks permissions through canvas ownership or shares
 */
export async function requireItemAccess(
  itemId: string,
  userId: string,
  userEmail: string,
  requiredLevel: 'VIEW' | 'COMMENT' | 'EDIT'
): Promise<CanvasAccessLevel> {
  const item = await prisma.canvasItem.findUnique({
    where: { id: itemId },
    select: {
      canvasId: true,
    },
  });

  if (!item) {
    throw new ForbiddenError('Item not found or access denied');
  }

  return await requireCanvasAccess(item.canvasId, userId, userEmail, requiredLevel);
}
