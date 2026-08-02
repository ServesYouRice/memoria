/**
 * Form Validation Utilities
 *
 * Client-side validation helpers using Zod schemas.
 *
 * @module lib/validation/form-validation
 */

import { z } from "zod";

/**
 * Canvas validation schemas
 */
export const canvasNameSchema = z
  .string()
  .min(1, "Canvas name is required")
  .max(200, "Canvas name must be 200 characters or less")
  .trim();

export const canvasDescriptionSchema = z
  .string()
  .max(1000, "Description must be 1000 characters or less")
  .optional()
  .nullable();

export const createCanvasSchema = z.object({
  name: canvasNameSchema,
  description: canvasDescriptionSchema,
  backgroundColor: z
    .string()
    .regex(/^#[0-9A-Fa-f]{6}$/, "Invalid color format")
    .optional(),
});

export const updateCanvasSchema = createCanvasSchema.partial();

/**
 * Canvas item validation schemas
 */
export const positionSchema = z.object({
  x: z.number().min(-10000).max(10000),
  y: z.number().min(-10000).max(10000),
});

export const dimensionSchema = z.object({
  width: z.number().min(50).max(2000),
  height: z.number().min(50).max(2000),
});

export const noteContentSchema = z.object({
  text: z.string().max(50000, "Note content too long"),
  title: z.string().max(200).optional(),
  backgroundColor: z.string().optional(),
});

export const bookmarkContentSchema = z.object({
  url: z.string().url("Invalid URL"),
  title: z.string().max(200).optional(),
  description: z.string().max(500).optional(),
  favicon: z.string().url().optional().nullable(),
  image: z.string().url().optional().nullable(),
});

export const imageContentSchema = z.object({
  url: z.string().url("Invalid image URL"),
  alt: z.string().max(200).optional(),
  caption: z.string().max(500).optional(),
});

export const createItemSchema = z.object({
  canvasId: z.string().cuid(),
  type: z.enum(["NOTE", "BOOKMARK", "IMAGE"]),
  x: z.number(),
  y: z.number(),
  width: z.number().min(50).optional(),
  height: z.number().min(50).optional(),
  content: z.record(z.string(), z.unknown()),
  tags: z.array(z.string()).optional(),
});

/**
 * User validation schemas
 */
export const emailSchema = z
  .string()
  .email("Invalid email address")
  .max(255)
  .toLowerCase();

export const passwordSchema = z
  .string()
  .min(8, "Password must be at least 8 characters")
  .max(128, "Password too long")
  .regex(/[a-z]/, "Password must contain a lowercase letter")
  .regex(/[A-Z]/, "Password must contain an uppercase letter")
  .regex(/[0-9]/, "Password must contain a number");

export const registerSchema = z.object({
  email: emailSchema,
  password: passwordSchema,
  name: z.string().min(1).max(100).optional(),
});

export const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1, "Password is required"),
});

/**
 * Comment validation
 */
export const commentSchema = z.object({
  content: z.string().min(1).max(5000),
  canvasId: z.string().cuid(),
  itemId: z.string().cuid().optional(),
  parentId: z.string().cuid().optional(),
});

/**
 * Share validation
 */
export const shareSchema = z.object({
  canvasId: z.string().cuid(),
  email: emailSchema,
  permission: z.enum(["VIEW", "EDIT", "ADMIN"]),
});

/**
 * Validate form data and return typed result
 */
export function validateForm<T extends z.ZodType>(
  schema: T,
  data: unknown,
):
  { success: true; data: z.infer<T> } | { success: false; errors: z.ZodError } {
  const result = schema.safeParse(data);
  if (result.success) {
    return { success: true, data: result.data };
  }
  return { success: false, errors: result.error };
}

/**
 * Get error message for a specific field
 */
export function getFieldError(
  errors: z.ZodError,
  field: string,
): string | undefined {
  const fieldError = errors.issues.find((e) => e.path.includes(field));
  return fieldError?.message;
}

/**
 * Convert Zod errors to form-friendly format
 */
export function formatErrors(errors: z.ZodError): Record<string, string> {
  const formatted: Record<string, string> = {};
  for (const error of errors.issues) {
    const field = error.path.join(".");
    if (!formatted[field]) {
      formatted[field] = error.message;
    }
  }
  return formatted;
}
