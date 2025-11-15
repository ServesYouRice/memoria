import { z } from 'zod';
import { ItemType } from '@prisma/client';
import { MAX_NOTE_TEXT_LENGTH, MIN_CANVAS_ITEM_WIDTH, MIN_CANVAS_ITEM_HEIGHT } from '@/lib/constants';

// Note content validation
export const noteContentSchema = z.object({
  text: z.string().min(1, 'Note text cannot be empty').max(MAX_NOTE_TEXT_LENGTH, 'Note text is too long'),
});

// Bookmark content validation
export const bookmarkContentSchema = z.object({
  url: z.string().url('Invalid URL'),
  title: z.string().optional(),
  description: z.string().optional(),
  imageUrl: z.string().url('Invalid image URL').optional(),
});

// Create item request validation
export const createItemSchema = z.object({
  type: z.nativeEnum(ItemType),
  positionX: z.number(),
  positionY: z.number(),
  width: z.number().min(MIN_CANVAS_ITEM_WIDTH, `Width must be at least ${MIN_CANVAS_ITEM_WIDTH}`),
  height: z.number().min(MIN_CANVAS_ITEM_HEIGHT, `Height must be at least ${MIN_CANVAS_ITEM_HEIGHT}`),
  content: z.union([noteContentSchema, bookmarkContentSchema]),
});

// Update item request validation
export const updateItemSchema = z.object({
  positionX: z.number().optional(),
  positionY: z.number().optional(),
  width: z.number().min(MIN_CANVAS_ITEM_WIDTH, `Width must be at least ${MIN_CANVAS_ITEM_WIDTH}`).optional(),
  height: z.number().min(MIN_CANVAS_ITEM_HEIGHT, `Height must be at least ${MIN_CANVAS_ITEM_HEIGHT}`).optional(),
  zIndex: z.number().optional(),
  content: z.union([noteContentSchema, bookmarkContentSchema]).optional(),
  version: z.number().int().positive('Version must be a positive integer'),
});

export type CreateItemInput = z.infer<typeof createItemSchema>;
export type UpdateItemInput = z.infer<typeof updateItemSchema>;
