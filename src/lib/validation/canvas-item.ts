/**
 * Validation schemas for Canvas Items
 * Following ADR-0001: API Versioning & Error Contract
 */

import { z } from "zod";
import { ItemType } from "@/types/canvas";
import { sanitizeUrl } from "@/lib/sanitization";
import { normalizeNoteContent } from "@/lib/rich-text/note-format";
import {
  MAX_URL_LENGTH,
  MAX_ZINDEX,
  MAX_TAG_LENGTH,
  MAX_TAGS_PER_ITEM,
  MAX_VIEWPORT_ITEMS,
  DEFAULT_VIEWPORT_LIMIT,
} from "@/lib/constants";

/**
 * URL validation schema for bookmarks
 * Only allows http/https protocols
 * Max length to prevent abuse
 */
const urlSchema = z
  .string()
  .url({ message: "Invalid URL format" })
  .max(MAX_URL_LENGTH, `URL must be less than ${MAX_URL_LENGTH} characters`)
  .refine(
    (url) => {
      try {
        const parsed = new URL(url);
        return parsed.protocol === "http:" || parsed.protocol === "https:";
      } catch {
        return false;
      }
    },
    { message: "URL must use http:// or https:// protocol" },
  );

/**
 * Note content validation
 * Sanitizes text to prevent XSS attacks
 */
export const noteContentSchema = z.unknown().transform((value, ctx) => {
  try {
    return normalizeNoteContent(value);
  } catch (error) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: error instanceof Error ? error.message : "Invalid note content.",
    });
    return z.NEVER;
  }
});

/**
 * Bookmark content validation
 * Phase 2 will add unfurling fields
 * Sanitizes URL to prevent javascript: and data: URIs
 */
export const bookmarkContentSchema = z.object({
  url: urlSchema.transform((val) => {
    const sanitized = sanitizeUrl(val);
    if (!sanitized) {
      throw new z.ZodError([
        {
          code: "custom",
          message: "URL contains potentially dangerous content",
          path: ["url"],
        },
      ]);
    }
    return sanitized;
  }),
  title: z.string().optional(),
  description: z.string().optional(),
  favicon: z.string().optional(),
  previewImage: z.string().optional(),
  siteName: z.string().optional(),
  unfurledAt: z.string().optional(),
});

/**
 * Image content validation
 */
export const imageContentSchema = z.object({
  url: z.string().refine((value) => {
    if (/^\/api\/v1\/uploads\/c[a-z0-9]{20,}$/i.test(value)) return true;
    try {
      const parsed = new URL(value);
      return parsed.protocol === "http:" || parsed.protocol === "https:";
    } catch {
      return false;
    }
  }, "Image URL must be an HTTP URL or a private upload URL"),
  filename: z.string().min(1),
  alt: z.string().optional(),
  width: z.number().positive().optional(),
  height: z.number().positive().optional(),
});

/**
 * Drawing path validation
 */
const drawingPathSchema = z.object({
  points: z.array(z.number()),
  stroke: z.string(),
  strokeWidth: z.number().positive(),
  opacity: z.number().min(0).max(1).optional(),
  tension: z.number().optional(),
});

/**
 * Drawing content validation
 */
export const drawingContentSchema = z.object({
  paths: z.array(drawingPathSchema),
});

/**
 * Shape content validation
 */
export const shapeContentSchema = z.object({
  shapeType: z.enum([
    "rectangle",
    "circle",
    "triangle",
    "diamond",
    "star",
    "arrow_shape",
  ]),
  stroke: z.string().optional(),
  fill: z.string().optional(),
  strokeWidth: z.number().positive().optional(),
  radius: z.number().nonnegative().optional(),
});

/**
 * Arrow content validation
 */
export const arrowContentSchema = z.object({
  startItemId: z.string().cuid().optional(),
  endItemId: z.string().cuid().optional(),
  startPoint: z.object({ x: z.number(), y: z.number() }).optional(),
  endPoint: z.object({ x: z.number(), y: z.number() }).optional(),
  stroke: z.string().optional(),
  strokeWidth: z.number().positive().optional(),
  arrowHeadStart: z.enum(["none", "arrow", "circle"]).optional(),
  arrowHeadEnd: z.enum(["none", "arrow", "circle"]).optional(),
  label: z.string().optional(),
});

/**
 * Text content validation
 */
export const textContentSchema = z.object({
  text: z.string(),
  fontSize: z.number().positive().optional(),
  fontFamily: z.string().optional(),
  align: z.enum(["left", "center", "right"]).optional(),
  color: z.string().optional(),
});

/**
 * Frame content validation
 */
export const frameContentSchema = z.object({
  title: z.string().optional(),
  backgroundColor: z.string().optional(),
});

/**
 * Embed content validation
 */
export const embedContentSchema = z.object({
  url: z.string().url(),
  embedType: z.enum(["youtube", "figma", "loom", "generic"]),
});

/**
 * Poll content validation
 */
export const pollContentSchema = z.object({
  question: z.string().min(1),
  options: z.array(
    z.object({
      id: z.string(),
      text: z.string(),
      votes: z.array(z.string()),
    }),
  ),
  multipleChoice: z.boolean().optional(),
});

export const canvasItemContentSchemas = {
  [ItemType.NOTE]: noteContentSchema,
  [ItemType.BOOKMARK]: bookmarkContentSchema,
  [ItemType.IMAGE]: imageContentSchema,
  [ItemType.DRAWING]: drawingContentSchema,
  [ItemType.SHAPE]: shapeContentSchema,
  [ItemType.ARROW]: arrowContentSchema,
  [ItemType.TEXT]: textContentSchema,
  [ItemType.FRAME]: frameContentSchema,
  [ItemType.EMBED]: embedContentSchema,
  [ItemType.POLL]: pollContentSchema,
} as const;

export function parseCanvasItemContent(type: string, content: unknown) {
  const schema = canvasItemContentSchemas[type as ItemType];
  if (!schema) {
    throw new z.ZodError([
      {
        code: "custom",
        message: `Unsupported item type: ${type}`,
        path: ["type"],
      },
    ]);
  }

  return schema.parse(content);
}

/**
 * Geometry validation
 */
export const geometrySchema = z.object({
  positionX: z.number().finite(),
  positionY: z.number().finite(),
  width: z.number().positive().finite(),
  height: z.number().positive().finite(),
  zIndex: z.number().int().min(0).max(MAX_ZINDEX),
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
  zIndex: z.number().int().min(0).max(MAX_ZINDEX).default(0),
  content: z.unknown(),
  tags: z
    .array(z.string().min(1).max(MAX_TAG_LENGTH))
    .max(MAX_TAGS_PER_ITEM)
    .default([]),
});

/**
 * Update canvas item payload
 * Following ADR-0009: Optimistic Concurrency Control
 */
export const updateCanvasItemSchema = z
  .object({
    version: z.number().int().positive(), // Required for optimistic locking
    positionX: z.number().finite().optional(),
    positionY: z.number().finite().optional(),
    width: z.number().positive().finite().optional(),
    height: z.number().positive().finite().optional(),
    zIndex: z.number().int().min(0).max(MAX_ZINDEX).optional(),
    content: z.unknown().optional(),
    tags: z
      .array(z.string().min(1).max(MAX_TAG_LENGTH))
      .max(MAX_TAGS_PER_ITEM)
      .optional(),
  })
  .strict();

/**
 * Delete canvas item payload
 */
export const deleteCanvasItemSchema = z
  .object({
    version: z.number().int().positive(), // Required for optimistic locking
  })
  .strict();

/**
 * Query parameters for listing items
 */
export const listCanvasItemsSchema = z.object({
  canvasId: z.string().cuid(),
  type: z.nativeEnum(ItemType).optional(),
  includeDeleted: z.boolean().default(false),
  limit: z
    .number()
    .int()
    .positive()
    .max(MAX_VIEWPORT_ITEMS)
    .default(MAX_VIEWPORT_ITEMS),
  offset: z.number().int().nonnegative().default(0),
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
  limit: z
    .number()
    .int()
    .positive()
    .max(MAX_VIEWPORT_ITEMS)
    .default(DEFAULT_VIEWPORT_LIMIT),
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
