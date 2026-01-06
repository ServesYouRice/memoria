import { auth } from '@/lib/auth';
import { Problems, problemToResponse } from '@/lib/errors';
import { prisma } from '@/lib/db';

/**
 * Get the current authenticated user
 * Returns null if not authenticated
 */
export async function getCurrentUser() {
  const session = await auth();
  return session?.user ?? null;
}

/**
 * Require authentication
 * Throws an error if not authenticated
 */
export async function requireAuth() {
  const user = await getCurrentUser();
  if (!user) {
    throw new Error('Unauthorized');
  }
  return user;
}

/**
 * Check if the current user owns a canvas
 * Following ADR: All data-access APIs must perform ownership checks
 */
export async function requireCanvasOwnership(canvasId: string) {
  const user = await requireAuth();

  const canvas = await prisma.canvas.findUnique({
    where: { id: canvasId },
    select: { userId: true },
  });

  if (!canvas) {
    throw new Error('Canvas not found');
  }

  if (canvas.userId !== user.id) {
    throw new Error('Forbidden');
  }

  return canvas;
}

/**
 * Check if the current user owns a canvas item
 */
export async function requireCanvasItemOwnership(itemId: string) {
  const user = await requireAuth();

  const item = await prisma.canvasItem.findUnique({
    where: { id: itemId },
    include: {
      canvas: {
        select: { userId: true },
      },
    },
  });

  if (!item) {
    throw new Error('Canvas item not found');
  }

  if (item.canvas.userId !== user.id) {
    throw new Error('Forbidden');
  }

  return item;
}

/**
 * Middleware wrapper for API routes that require authentication
 */
export function withAuth<T>(
  handler: (user: NonNullable<Awaited<ReturnType<typeof getCurrentUser>>>) => Promise<T>
) {
  return async (): Promise<T> => {
    const user = await requireAuth();
    return handler(user);
  };
}

/**
 * Error handler for auth-related errors
 */
export function handleAuthError(error: unknown): Response {
  if (error instanceof Error) {
    if (error.message === 'Unauthorized') {
      return problemToResponse(Problems.Unauthorized());
    }
    if (error.message === 'Forbidden') {
      return problemToResponse(Problems.Forbidden());
    }
    if (error.message.includes('not found')) {
      return problemToResponse(Problems.NotFound(error.message));
    }
  }
  return problemToResponse(Problems.InternalServerError());
}
