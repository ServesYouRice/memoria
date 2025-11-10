import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createItemSchema, updateItemSchema } from '@/lib/validation';
import { ItemType } from '@prisma/client';

describe('Item Validation Schemas', () => {
  describe('createItemSchema', () => {
    it('should validate a valid note creation request', () => {
      const validNote = {
        type: ItemType.NOTE,
        positionX: 100,
        positionY: 200,
        width: 200,
        height: 150,
        content: {
          text: 'This is a test note',
        },
      };

      const result = createItemSchema.safeParse(validNote);
      expect(result.success).toBe(true);
    });

    it('should reject note with invalid width', () => {
      const invalidNote = {
        type: ItemType.NOTE,
        positionX: 100,
        positionY: 200,
        width: 30, // Too small
        height: 150,
        content: {
          text: 'Test',
        },
      };

      const result = createItemSchema.safeParse(invalidNote);
      expect(result.success).toBe(false);
    });

    it('should reject note with empty text', () => {
      const invalidNote = {
        type: ItemType.NOTE,
        positionX: 100,
        positionY: 200,
        width: 200,
        height: 150,
        content: {
          text: '',
        },
      };

      const result = createItemSchema.safeParse(invalidNote);
      expect(result.success).toBe(false);
    });
  });

  describe('updateItemSchema', () => {
    it('should validate a valid update request', () => {
      const validUpdate = {
        positionX: 150,
        positionY: 250,
        version: 1,
      };

      const result = updateItemSchema.safeParse(validUpdate);
      expect(result.success).toBe(true);
    });

    it('should validate update with content change', () => {
      const validUpdate = {
        content: {
          text: 'Updated text',
        },
        version: 2,
      };

      const result = updateItemSchema.safeParse(validUpdate);
      expect(result.success).toBe(true);
    });

    it('should require version field', () => {
      const invalidUpdate = {
        positionX: 150,
        positionY: 250,
      };

      const result = updateItemSchema.safeParse(invalidUpdate);
      expect(result.success).toBe(false);
    });

    it('should reject negative version', () => {
      const invalidUpdate = {
        positionX: 150,
        version: -1,
      };

      const result = updateItemSchema.safeParse(invalidUpdate);
      expect(result.success).toBe(false);
    });
  });
});

describe('API Error Handling', () => {
  it('should create proper error responses', async () => {
    const { ApiError } = await import('@/lib/api-error');

    const error = new ApiError(404, 'Not Found', 'Item not found');
    expect(error.status).toBe(404);
    expect(error.title).toBe('Not Found');
    expect(error.detail).toBe('Item not found');
  });
});
