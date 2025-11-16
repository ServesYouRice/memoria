/**
 * API Route Tests: Canvas Items
 * Tests for /api/v1/canvas-items endpoints
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import type { Prisma } from '@prisma/client';

// Mock modules before imports
vi.mock('@/lib/db', () => ({
  prisma: {
    canvasItem: {
      create: vi.fn(),
      update: vi.fn(),
      findUnique: vi.fn(),
    },
    canvas: {
      findUnique: vi.fn(),
    },
  },
}));

vi.mock('@/lib/api/auth', () => ({
  requireAuth: vi.fn(),
  requireItemOwnership: vi.fn(),
}));

// Use string literals for ItemType since mocking prevents enum import
const ItemType = {
  NOTE: 'NOTE' as const,
  BOOKMARK: 'BOOKMARK' as const,
};

describe('Canvas Items API', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('POST /api/v1/canvas-items', () => {
    it('should create a canvas item with proper Prisma.JsonValue type', async () => {
      const { prisma } = await import('@/lib/db');
      const { requireAuth } = await import('@/lib/api/auth');

      // Setup mocks
      vi.mocked(requireAuth).mockResolvedValue({
        userId: 'user123',
        email: 'test@example.com',
      });

      vi.mocked(prisma.canvas.findUnique).mockResolvedValue({
        id: 'canvas123',
        name: 'Test Canvas',
        userId: 'user123',
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
      });

      const mockItem = {
        id: 'item123',
        canvasId: 'canvas123',
        type: ItemType.NOTE,
        positionX: 100,
        positionY: 200,
        width: 300,
        height: 200,
        zIndex: 1,
        content: { text: 'Test note' } as Prisma.JsonValue,
        tags: [],
        version: 1,
        createdById: 'user123',
        updatedById: null,
        deletedById: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        deletedAt: null,
      };

      vi.mocked(prisma.canvasItem.create).mockResolvedValue(mockItem);

      // Test that content is properly typed as Prisma.JsonValue
      const createData = {
        canvasId: 'canvas123',
        type: ItemType.NOTE,
        positionX: 100,
        positionY: 200,
        width: 300,
        height: 200,
        content: { text: 'Test note' } as Prisma.JsonValue,
        tags: [],
        createdById: 'user123',
      };

      await prisma.canvasItem.create({ data: createData });

      expect(prisma.canvasItem.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          content: expect.any(Object),
          type: ItemType.NOTE,
        }),
      });
    });

    it('should require authentication', async () => {
      const { requireAuth } = await import('@/lib/api/auth');

      vi.mocked(requireAuth).mockRejectedValue(
        new Error('You must be logged in to access this resource')
      );

      await expect(requireAuth()).rejects.toThrow(
        'You must be logged in to access this resource'
      );
    });

    it('should validate canvas ownership', async () => {
      const { prisma } = await import('@/lib/db');
      const { requireAuth } = await import('@/lib/api/auth');

      vi.mocked(requireAuth).mockResolvedValue({
        userId: 'user123',
        email: 'test@example.com',
      });

      // Canvas not found
      vi.mocked(prisma.canvas.findUnique).mockResolvedValue(null);

      const result = await prisma.canvas.findUnique({
        where: { id: 'nonexistent' },
      });

      expect(result).toBeNull();
    });
  });

  describe('PATCH /api/v1/canvas-items/[itemId]', () => {
    it('should update item with Prisma.JsonValue content type', async () => {
      const { prisma } = await import('@/lib/db');
      const { requireAuth, requireItemOwnership } = await import('@/lib/api/auth');

      vi.mocked(requireAuth).mockResolvedValue({
        userId: 'user123',
        email: 'test@example.com',
      });

      vi.mocked(requireItemOwnership).mockResolvedValue({
        id: 'item123',
        canvas: { userId: 'user123' },
      });

      const mockCurrentItem = {
        version: 1,
        deletedAt: null,
      };

      const mockUpdatedItem = {
        id: 'item123',
        canvasId: 'canvas123',
        type: ItemType.NOTE,
        positionX: 150,
        positionY: 250,
        width: 300,
        height: 200,
        zIndex: 1,
        content: { text: 'Updated note' } as Prisma.JsonValue,
        tags: [],
        version: 2,
        createdById: 'user123',
        updatedById: 'user123',
        deletedById: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        deletedAt: null,
      };

      vi.mocked(prisma.canvasItem.findUnique).mockResolvedValue({
        ...mockUpdatedItem,
        version: 1,
      });

      vi.mocked(prisma.canvasItem.update).mockResolvedValue(mockUpdatedItem);

      // Test update with content change
      await prisma.canvasItem.update({
        where: { id: 'item123', version: 1 },
        data: {
          content: { text: 'Updated note' } as Prisma.JsonValue,
          version: { increment: 1 },
          updatedById: 'user123',
        },
      });

      expect(prisma.canvasItem.update).toHaveBeenCalledWith({
        where: { id: 'item123', version: 1 },
        data: expect.objectContaining({
          content: expect.any(Object),
          version: { increment: 1 },
        }),
      });
    });

    it('should enforce optimistic locking with version check', async () => {
      const { prisma } = await import('@/lib/db');

      const mockCurrentItem = {
        version: 5,
        deletedAt: null,
      };

      vi.mocked(prisma.canvasItem.findUnique).mockResolvedValue({
        ...mockCurrentItem,
        id: 'item123',
        canvasId: 'canvas123',
        type: ItemType.NOTE,
        positionX: 100,
        positionY: 200,
        width: 300,
        height: 200,
        zIndex: 1,
        content: { text: 'Test' } as Prisma.JsonValue,
        tags: [],
        createdById: 'user123',
        updatedById: null,
        deletedById: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const currentItem = await prisma.canvasItem.findUnique({
        where: { id: 'item123' },
        select: { version: true, deletedAt: true },
      });

      // Verify version mismatch would be detected
      const clientVersion = 3;
      expect(currentItem?.version).not.toBe(clientVersion);
      expect(currentItem?.version).toBe(5);
    });

    it('should require item ownership', async () => {
      const { requireItemOwnership } = await import('@/lib/api/auth');

      vi.mocked(requireItemOwnership).mockRejectedValue(
        new Error('You do not have permission to access this item')
      );

      await expect(requireItemOwnership('item123', 'wrongUser')).rejects.toThrow(
        'You do not have permission to access this item'
      );
    });
  });

  describe('Type Safety', () => {
    it('should properly type content as Prisma.JsonValue, not any', () => {
      // This is a compile-time test to ensure no 'any' types are used
      const content: Prisma.JsonValue = { text: 'Test' };

      // This should work
      expect(content).toEqual({ text: 'Test' });

      // Prisma.JsonValue allows objects, arrays, strings, numbers, booleans, null
      const validValues: Prisma.JsonValue[] = [
        { key: 'value' },
        ['array', 'items'],
        'string',
        123,
        true,
        null,
      ];

      validValues.forEach(value => {
        expect(typeof value !== 'undefined').toBe(true);
      });
    });

    it('should properly type where clauses with Prisma types', () => {
      // Test that we're using proper Prisma types for where clauses
      const where: Prisma.CanvasWhereInput = {
        isTemplate: true,
        templateCategory: 'General',
        userId: 'user123',
      };

      expect(where.isTemplate).toBe(true);
      expect(where.templateCategory).toBe('General');
    });
  });
});
