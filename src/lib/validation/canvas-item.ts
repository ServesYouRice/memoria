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
  tags: z.array(z.string().min(1).max(50)).max(20).default([]),
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
  tags: z.array(z.string().min(1).max(50)).max(20).optional(),
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
 * Viewport-based pagination schema
 *
 * Viewport Intersection Algorithm:
 * An item is considered "in viewport" if its bounding box intersects with the viewport bounds.
 *
 * Intersection check:
 * (item.positionX + item.width) >= minX  &&  // item right edge >= viewport left
 * item.positionX <= maxX                 &&  // item left edge <= viewport right
 * (item.positionY + item.height) >= minY &&  // item bottom edge >= viewport top
 * item.positionY <= maxY                     // item top edge <= viewport bottom
 *
 * This ensures we only load items that are visible or partially visible in the viewport.
 * For large canvases (10k+ items), this dramatically reduces data transfer and rendering overhead.
 */
export const viewportPaginationSchema = z.object({
  canvasId: z.string().cuid(),
  type: z.nativeEnum(ItemType).optional(),
  includeDeleted: z.boolean().default(false),
  // Viewport bounds (required for viewport filtering)
  minX: z.number().finite().optional(),
  maxX: z.number().finite().optional(),
  minY: z.number().finite().optional(),
  maxY: z.number().finite().optional(),
  // Pagination parameters
  limit: z.number().int().positive().max(1000).default(100),
  offset: z.number().int().nonnegative().default(0),
});

/**
 * Type inference
 */
export type CreateCanvasItemInput = z.infer<typeof createCanvasItemSchema>;
export type UpdateCanvasItemInput = z.infer<typeof updateCanvasItemSchema>;
export type DeleteCanvasItemInput = z.infer<typeof deleteCanvasItemSchema>;
export type ListCanvasItemsInput = z.infer<typeof listCanvasItemsSchema>;
export type ViewportPaginationInput = z.infer<typeof viewportPaginationSchema>;
