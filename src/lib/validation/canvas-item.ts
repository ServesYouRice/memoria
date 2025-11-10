/**
 * Validation schemas for Canvas Items
 * Following ADR-0001: API Versioning & Error Contract
 */

import { z } from 'zod';
import { ItemType } from '@/types/canvas';

/**
 * URL validation schema for bookmarks
 * Only allows http/https protocols
 * Max length to prevent abuse
 */
const urlSchema = z
  .string()
  .url({ message: 'Invalid URL format' })
  .max(2048, 'URL must be less than 2048 characters')
  .refine(
    (url) => {
      try {
        const parsed = new URL(url);
        return parsed.protocol === 'http:' || parsed.protocol === 'https:';
      } catch {
        return false;
      }
    },
    { message: 'URL must use http:// or https:// protocol' }
  );

/**
 * Note content validation
 */
export const noteContentSchema = z.object({
  text: z.string().min(1, 'Note text cannot be empty').max(10000, 'Note text too long'),
});

/**
 * Bookmark content validation
 * Phase 2 will add unfurling fields
 */
export const bookmarkContentSchema = z.object({
  url: urlSchema,
});

/**
 * Geometry validation
 */
export const geometrySchema = z.object({
  positionX: z.number().finite(),
  positionY: z.number().finite(),
  width: z.number().positive().finite(),
  height: z.number().positive().finite(),
  zIndex: z.number().int().min(0).max(999999),
});

/**
 * Create canvas item payload
 */
export const createCanvasItemSchema = z.object({
  canvasId: z.string().cuid(),
  type: z.nativeEnum(ItemType),
  positionX: z.number().finite(),
  positionY: z.number().finite(),
  width: z.number().positive().finite(),
  height: z.number().positive().finite(),
  zIndex: z.number().int().min(0).max(999999).default(0),
  content: z.union([noteContentSchema, bookmarkContentSchema]),
});

/**
 * Update canvas item payload
 * Following ADR-0009: Optimistic Concurrency Control
 */
export const updateCanvasItemSchema = z.object({
  version: z.number().int().positive(), // Required for optimistic locking
  positionX: z.number().finite().optional(),
  positionY: z.number().finite().optional(),
  width: z.number().positive().finite().optional(),
  height: z.number().positive().finite().optional(),
  zIndex: z.number().int().min(0).max(999999).optional(),
  content: z.union([noteContentSchema, bookmarkContentSchema]).optional(),
});

/**
 * Delete canvas item payload
 */
export const deleteCanvasItemSchema = z.object({
  version: z.number().int().positive(), // Required for optimistic locking
});

/**
 * Query parameters for listing items
 */
export const listCanvasItemsSchema = z.object({
  canvasId: z.string().cuid(),
  type: z.nativeEnum(ItemType).optional(),
  includeDeleted: z.boolean().default(false),
});

/**
 * Type inference
 */
export type CreateCanvasItemInput = z.infer<typeof createCanvasItemSchema>;
export type UpdateCanvasItemInput = z.infer<typeof updateCanvasItemSchema>;
export type DeleteCanvasItemInput = z.infer<typeof deleteCanvasItemSchema>;
export type ListCanvasItemsInput = z.infer<typeof listCanvasItemsSchema>;
