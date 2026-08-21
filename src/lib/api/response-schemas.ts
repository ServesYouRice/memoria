import { ItemType } from "@/generated/prisma/client";
import { z } from "zod";

export const canvasItemResponseSchema = z
  .object({
    id: z.string().cuid(),
    canvasId: z.string().cuid(),
    type: z.nativeEnum(ItemType),
    positionX: z.number().finite(),
    positionY: z.number().finite(),
    width: z.number().finite(),
    height: z.number().finite(),
    zIndex: z.number().int(),
    content: z.unknown(),
    tags: z.array(z.string()),
    version: z.number().int().positive(),
  })
  .passthrough();

export const canvasItemListResponseSchema = z
  .object({
    items: z.array(canvasItemResponseSchema),
    total: z.number().int().nonnegative(),
    limit: z.number().int().positive().optional(),
    offset: z.number().int().nonnegative().optional(),
    nextCursor: z.string().nullable().optional(),
    hasMore: z.boolean(),
    truncatedByBytes: z.boolean(),
  })
  .strict();

export const publicCanvasShareResponseSchema = z
  .object({
    canvas: z
      .object({
        id: z.string().cuid(),
        name: z.string(),
        owner: z.string(),
        zoomLevel: z.number(),
        panX: z.number(),
        panY: z.number(),
      })
      .strict(),
    items: z.array(canvasItemResponseSchema),
    total: z.number().int().nonnegative(),
    limit: z.number().int().positive().optional(),
    offset: z.number().int().nonnegative().optional(),
    nextCursor: z.string().nullable().optional(),
    hasMore: z.boolean(),
    truncatedByBytes: z.boolean(),
  })
  .strict();

export const canvasListResponseSchema = z
  .object({
    canvases: z.array(
      z
        .object({
          id: z.string().cuid(),
          name: z.string(),
          userId: z.string().cuid(),
          workspaceId: z.string().cuid().nullable(),
          zoomLevel: z.number(),
          panX: z.number(),
          panY: z.number(),
          thumbnailKey: z.string().nullable(),
          thumbnailRevision: z.string().regex(/^\d+$/),
          isPublic: z.boolean(),
          createdAt: z.union([z.date(), z.string()]),
          updatedAt: z.union([z.date(), z.string()]),
        })
        .strict(),
    ),
    pagination: z
      .object({
        total: z.number().int().nonnegative(),
        limit: z.number().int().positive(),
        offset: z.number().int().nonnegative(),
        hasMore: z.boolean(),
      })
      .strict(),
  })
  .strict();

export const sharedCanvasResponseSchema = z
  .object({
    canvases: z.array(
      z
        .object({
          id: z.string().cuid(),
          name: z.string(),
          thumbnailKey: z.string().nullable().optional(),
          thumbnailRevision: z.string().regex(/^\d+$/).optional(),
          itemCount: z.number().int().nonnegative(),
          owner: z
            .object({
              name: z.string().nullable(),
            })
            .strict(),
          role: z.enum(["VIEW", "COMMENT", "EDIT"]),
          sharedAt: z.union([z.date(), z.string()]),
          updatedAt: z.union([z.date(), z.string()]),
        })
        .strict(),
    ),
  })
  .strict();

export type CanvasItemResponse = z.infer<typeof canvasItemResponseSchema>;
export type CanvasItemListResponse = z.infer<
  typeof canvasItemListResponseSchema
>;
export type PublicCanvasShareResponse = z.infer<
  typeof publicCanvasShareResponseSchema
>;
export type CanvasListResponse = z.infer<typeof canvasListResponseSchema>;
export type SharedCanvasResponse = z.infer<typeof sharedCanvasResponseSchema>;
