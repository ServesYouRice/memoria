/**
 * API Auth Helpers Tests
 * Tests for /lib/api/auth.ts helpers
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

// Mock dependencies
vi.mock('next-auth', () => ({
  getServerSession: vi.fn(),
}));

vi.mock('@/lib/db', () => ({
  prisma: {
    canvas: {
      findUnique: vi.fn(),
    },
    canvasItem: {
      findUnique: vi.fn(),
    },
  },
}));

describe('Auth Helpers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('requireAuth', () => {
    it('should return userId and email when session is valid', async () => {
      const { getServerSession } = await import('next-auth');
      const { requireAuth } = await import('@/lib/api/auth');

      vi.mocked(getServerSession).mockResolvedValue({
        user: {
          id: 'user123',
          email: 'test@example.com',
        },
        expires: '2025-12-31',
      });

      const result = await requireAuth();

      expect(result).toEqual({
        userId: 'user123',
        email: 'test@example.com',
      });
    });

    it('should throw when session is null', async () => {
      const { getServerSession } = await import('next-auth');
      const { requireAuth } = await import('@/lib/api/auth');
      const { UnauthorizedError } = await import('@/lib/errors');

      vi.mocked(getServerSession).mockResolvedValue(null);

      await expect(requireAuth()).rejects.toThrow(UnauthorizedError);
    });

    it('should throw when session.user is null', async () => {
      const { getServerSession } = await import('next-auth');
      const { requireAuth } = await import('@/lib/api/auth');
      const { UnauthorizedError } = await import('@/lib/errors');

      vi.mocked(getServerSession).mockResolvedValue({
        user: null,
        expires: '2025-12-31',
      });

      await expect(requireAuth()).rejects.toThrow(UnauthorizedError);
    });

    it('should throw when session.user.email is missing', async () => {
      const { getServerSession } = await import('next-auth');
      const { requireAuth } = await import('@/lib/api/auth');
      const { UnauthorizedError } = await import('@/lib/errors');

      vi.mocked(getServerSession).mockResolvedValue({
        user: {
          id: 'user123',
          email: null,
        },
        expires: '2025-12-31',
      });

      await expect(requireAuth()).rejects.toThrow(UnauthorizedError);
    });

    it('should throw when session.user.id is missing (type guard check)', async () => {
      const { getServerSession } = await import('next-auth');
      const { requireAuth } = await import('@/lib/api/auth');
      const { UnauthorizedError } = await import('@/lib/errors');

      vi.mocked(getServerSession).mockResolvedValue({
        user: {
          id: null,
          email: 'test@example.com',
        },
        expires: '2025-12-31',
      });

      await expect(requireAuth()).rejects.toThrow(UnauthorizedError);
    });

    it('should not use unsafe type casts (no "as string")', async () => {
      const { getServerSession } = await import('next-auth');
      const { requireAuth } = await import('@/lib/api/auth');

      vi.mocked(getServerSession).mockResolvedValue({
        user: {
          id: 'user123',
          email: 'test@example.com',
        },
        expires: '2025-12-31',
      });

      const result = await requireAuth();

      // The result should have properly typed userId without type casting
      expect(typeof result.userId).toBe('string');
      expect(result.userId).toBe('user123');
    });
  });

  describe('requireCanvasOwnership', () => {
    it('should return canvas when user owns it', async () => {
      const { prisma } = await import('@/lib/db');
      const { requireCanvasOwnership } = await import('@/lib/api/auth');

      vi.mocked(prisma.canvas.findUnique).mockResolvedValue({
        userId: 'user123',
      });

      const result = await requireCanvasOwnership('canvas123', 'user123');

      expect(result).toEqual({ userId: 'user123' });
      expect(prisma.canvas.findUnique).toHaveBeenCalledWith({
        where: { id: 'canvas123' },
        select: { userId: true },
      });
    });

    it('should throw when canvas not found', async () => {
      const { prisma } = await import('@/lib/db');
      const { requireCanvasOwnership } = await import('@/lib/api/auth');
      const { ForbiddenError } = await import('@/lib/errors');

      vi.mocked(prisma.canvas.findUnique).mockResolvedValue(null);

      await expect(requireCanvasOwnership('canvas123', 'user123')).rejects.toThrow(
        ForbiddenError
      );
    });

    it('should throw when user does not own canvas', async () => {
      const { prisma } = await import('@/lib/db');
      const { requireCanvasOwnership } = await import('@/lib/api/auth');
      const { ForbiddenError } = await import('@/lib/errors');

      vi.mocked(prisma.canvas.findUnique).mockResolvedValue({
        userId: 'otherUser',
      });

      await expect(requireCanvasOwnership('canvas123', 'user123')).rejects.toThrow(
        ForbiddenError
      );
    });
  });

  describe('requireItemOwnership', () => {
    it('should return item when user owns the canvas', async () => {
      const { prisma } = await import('@/lib/db');
      const { requireItemOwnership } = await import('@/lib/api/auth');

      const mockItem = {
        id: 'item123',
        canvas: {
          userId: 'user123',
        },
      };

      vi.mocked(prisma.canvasItem.findUnique).mockResolvedValue(mockItem);

      const result = await requireItemOwnership('item123', 'user123');

      expect(result).toEqual(mockItem);
      expect(prisma.canvasItem.findUnique).toHaveBeenCalledWith({
        where: { id: 'item123' },
        select: {
          id: true,
          canvas: {
            select: { userId: true },
          },
        },
      });
    });

    it('should throw when item not found', async () => {
      const { prisma } = await import('@/lib/db');
      const { requireItemOwnership } = await import('@/lib/api/auth');
      const { ForbiddenError } = await import('@/lib/errors');

      vi.mocked(prisma.canvasItem.findUnique).mockResolvedValue(null);

      await expect(requireItemOwnership('item123', 'user123')).rejects.toThrow(
        ForbiddenError
      );
    });

    it('should throw when user does not own the canvas', async () => {
      const { prisma } = await import('@/lib/db');
      const { requireItemOwnership } = await import('@/lib/api/auth');
      const { ForbiddenError } = await import('@/lib/errors');

      vi.mocked(prisma.canvasItem.findUnique).mockResolvedValue({
        id: 'item123',
        canvas: {
          userId: 'otherUser',
        },
      });

      await expect(requireItemOwnership('item123', 'user123')).rejects.toThrow(
        ForbiddenError
      );
    });
  });
});
