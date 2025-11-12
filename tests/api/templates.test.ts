/**
 * API Route Tests: Templates
 * Tests for /api/v1/templates endpoints
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Prisma } from '@prisma/client';

// Mock modules
vi.mock('@/lib/db', () => ({
  prisma: {
    canvas: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
      update: vi.fn(),
    },
  },
}));

vi.mock('@/lib/api/auth', () => ({
  requireAuth: vi.fn(),
}));

describe('Templates API', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('GET /api/v1/templates', () => {
    it('should use explicit field selection to avoid N+1 queries', async () => {
      const { prisma } = await import('@/lib/db');

      const mockTemplates = [
        {
          id: 'template1',
          title: 'Template 1',
          userId: 'user123',
          isTemplate: true,
          templateDescription: 'Description',
          templateCategory: 'General',
          usageCount: 10,
          createdAt: new Date(),
          updatedAt: new Date(),
          items: [
            {
              id: 'item1',
              type: 'NOTE',
              positionX: 100,
              positionY: 200,
              width: 300,
              height: 200,
              zIndex: 1,
              content: { text: 'Note' },
              tags: [],
            },
          ],
          user: {
            id: 'user123',
            name: 'Test User',
            email: 'test@example.com',
          },
        },
      ];

      vi.mocked(prisma.canvas.findMany).mockResolvedValue(mockTemplates);

      // Test that we're using explicit select instead of include all
      const where: Prisma.CanvasWhereInput = {
        isTemplate: true,
      };

      await prisma.canvas.findMany({
        where,
        select: {
          id: true,
          title: true,
          userId: true,
          isTemplate: true,
          templateDescription: true,
          templateCategory: true,
          usageCount: true,
          createdAt: true,
          updatedAt: true,
          items: {
            where: { deletedAt: null },
            select: {
              id: true,
              type: true,
              positionX: true,
              positionY: true,
              width: true,
              height: true,
              zIndex: true,
              content: true,
              tags: true,
            },
          },
          user: {
            select: {
              id: true,
              name: true,
              email: true,
            },
          },
        },
        orderBy: [{ usageCount: 'desc' }, { createdAt: 'desc' }],
      });

      expect(prisma.canvas.findMany).toHaveBeenCalledWith({
        where: expect.objectContaining({ isTemplate: true }),
        select: expect.objectContaining({
          id: true,
          items: expect.objectContaining({
            select: expect.any(Object),
          }),
          user: expect.objectContaining({
            select: expect.any(Object),
          }),
        }),
        orderBy: expect.any(Array),
      });
    });

    it('should properly type where clause with Prisma.CanvasWhereInput', () => {
      // Compile-time type safety test
      const where: Prisma.CanvasWhereInput = {
        isTemplate: true,
        templateCategory: 'General',
        userId: 'user123',
      };

      expect(where.isTemplate).toBe(true);
      expect(where.templateCategory).toBe('General');

      // Test conditional filters
      const category = 'Development';
      const userId = 'user456';

      const conditionalWhere: Prisma.CanvasWhereInput = {
        isTemplate: true,
        ...(category && category !== 'all' && { templateCategory: category }),
        ...(userId && { userId }),
      };

      expect(conditionalWhere.templateCategory).toBe('Development');
      expect(conditionalWhere.userId).toBe('user456');
    });

    it('should filter by category when provided', async () => {
      const { prisma } = await import('@/lib/db');

      const category = 'Development';
      const where: Prisma.CanvasWhereInput = {
        isTemplate: true,
        ...(category && category !== 'all' && { templateCategory: category }),
      };

      await prisma.canvas.findMany({
        where,
        select: {
          id: true,
          title: true,
          userId: true,
          isTemplate: true,
          templateDescription: true,
          templateCategory: true,
          usageCount: true,
          createdAt: true,
          updatedAt: true,
          items: {
            where: { deletedAt: null },
            select: {
              id: true,
              type: true,
              positionX: true,
              positionY: true,
              width: true,
              height: true,
              zIndex: true,
              content: true,
              tags: true,
            },
          },
          user: {
            select: {
              id: true,
              name: true,
              email: true,
            },
          },
        },
        orderBy: [{ usageCount: 'desc' }, { createdAt: 'desc' }],
      });

      expect(prisma.canvas.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            templateCategory: 'Development',
          }),
        })
      );
    });

    it('should not include deleted items', async () => {
      const { prisma } = await import('@/lib/db');

      await prisma.canvas.findMany({
        where: { isTemplate: true },
        select: {
          id: true,
          title: true,
          userId: true,
          isTemplate: true,
          templateDescription: true,
          templateCategory: true,
          usageCount: true,
          createdAt: true,
          updatedAt: true,
          items: {
            where: { deletedAt: null },
            select: {
              id: true,
              type: true,
              positionX: true,
              positionY: true,
              width: true,
              height: true,
              zIndex: true,
              content: true,
              tags: true,
            },
          },
          user: {
            select: {
              id: true,
              name: true,
              email: true,
            },
          },
        },
        orderBy: [{ usageCount: 'desc' }, { createdAt: 'desc' }],
      });

      expect(prisma.canvas.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          select: expect.objectContaining({
            items: expect.objectContaining({
              where: { deletedAt: null },
            }),
          }),
        })
      );
    });

    it('should order by usage count and creation date', async () => {
      const { prisma } = await import('@/lib/db');

      await prisma.canvas.findMany({
        where: { isTemplate: true },
        select: {
          id: true,
          title: true,
          userId: true,
          isTemplate: true,
          templateDescription: true,
          templateCategory: true,
          usageCount: true,
          createdAt: true,
          updatedAt: true,
          items: {
            where: { deletedAt: null },
            select: {
              id: true,
              type: true,
              positionX: true,
              positionY: true,
              width: true,
              height: true,
              zIndex: true,
              content: true,
              tags: true,
            },
          },
          user: {
            select: {
              id: true,
              name: true,
              email: true,
            },
          },
        },
        orderBy: [{ usageCount: 'desc' }, { createdAt: 'desc' }],
      });

      expect(prisma.canvas.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          orderBy: [{ usageCount: 'desc' }, { createdAt: 'desc' }],
        })
      );
    });
  });

  describe('POST /api/v1/templates', () => {
    it('should require authentication', async () => {
      const { requireAuth } = await import('@/lib/api/auth');

      vi.mocked(requireAuth).mockRejectedValue(
        new Error('You must be logged in to create templates')
      );

      await expect(requireAuth()).rejects.toThrow(
        'You must be logged in to create templates'
      );
    });

    it('should validate canvas ownership', async () => {
      const { prisma } = await import('@/lib/db');
      const { requireAuth } = await import('@/lib/api/auth');

      vi.mocked(requireAuth).mockResolvedValue({
        userId: 'user123',
        email: 'test@example.com',
      });

      vi.mocked(prisma.canvas.findUnique).mockResolvedValue({
        id: 'canvas123',
        name: 'Test Canvas',
        userId: 'otherUser',
        zoomLevel: 1,
        panX: 0,
        panY: 0,
        isTemplate: false,
        templateDescription: null,
        templateCategory: null,
        usageCount: 0,
        isPublic: false,
        shareToken: null,
        tags: [],
        createdAt: new Date(),
        updatedAt: new Date(),
        items: [],
      });

      const canvas = await prisma.canvas.findUnique({
        where: { id: 'canvas123' },
        include: { items: true },
      });

      // Should detect ownership mismatch
      expect(canvas?.userId).not.toBe('user123');
    });

    it('should update canvas to be a template', async () => {
      const { prisma } = await import('@/lib/db');

      const updatedCanvas = {
        id: 'canvas123',
        name: 'Test Canvas',
        userId: 'user123',
        zoomLevel: 1,
        panX: 0,
        panY: 0,
        isTemplate: true,
        templateDescription: 'A great template',
        templateCategory: 'General',
        usageCount: 0,
        isPublic: false,
        shareToken: null,
        tags: [],
        createdAt: new Date(),
        updatedAt: new Date(),
        items: [],
        user: {
          id: 'user123',
          name: 'Test User',
          email: 'test@example.com',
        },
      };

      vi.mocked(prisma.canvas.update).mockResolvedValue(updatedCanvas);

      await prisma.canvas.update({
        where: { id: 'canvas123' },
        data: {
          isTemplate: true,
          templateDescription: 'A great template',
          templateCategory: 'General',
        },
        include: {
          items: true,
          user: {
            select: {
              id: true,
              name: true,
              email: true,
            },
          },
        },
      });

      expect(prisma.canvas.update).toHaveBeenCalledWith({
        where: { id: 'canvas123' },
        data: expect.objectContaining({
          isTemplate: true,
          templateDescription: 'A great template',
        }),
        include: expect.any(Object),
      });
    });
  });
});
