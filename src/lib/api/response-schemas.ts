import { ItemType } from "@prisma/client";
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
          createdAt: z.date(),
          updatedAt: z.date(),
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
