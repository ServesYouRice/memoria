import { z } from "zod";
import { MAX_URL_LENGTH } from "@/lib/constants";

const httpUrlSchema = z
  .string()
  .trim()
  .url()
  .max(MAX_URL_LENGTH)
  .refine((value) => /^https?:$/i.test(new URL(value).protocol), {
    message: "Only http:// and https:// links can be saved.",
  });

// The limits of the stored bookmark (bookmarkContentSchema): over-long input
// is refused, as in clipBatchSchema, rather than cut.
export const clipSchema = z.object({
  url: httpUrlSchema,
  title: z.string().trim().max(500).optional(),
  selection: z.string().max(2000).optional(),
  canvasId: z.string().cuid().optional(),
  /** Save even when the link is already in the user's boards (IMP-065). */
  allowDuplicate: z.boolean().optional(),
});

export const webhookSchema = z.object({
  type: z.enum(["note", "bookmark"]),
  content: z.string(),
  title: z.string().optional(),
  description: z.string().optional(),
  canvasId: z.string().cuid().optional(),
});

/** Most links one clip batch may carry (IMP-061). */
export const CLIP_BATCH_MAX_LINKS = 100;
/** Longest "How should these be sorted?" note a batch may carry. */
export const CLIP_BATCH_NOTE_MAX_LENGTH = 2000;

/**
 * One request that saves many links to the Inbox at once: the browser
 * extension's "save all tabs" (IMP-061) and the phone share target (IMP-062).
 * The client picks the idempotency key once per batch and reuses it on retry.
 */
export const clipBatchSchema = z.object({
  idempotencyKey: z
    .string()
    .trim()
    .min(8)
    .max(128)
    .regex(/^[A-Za-z0-9_-]+$/, {
      message: "Use letters, digits, '-' or '_' in the idempotency key.",
    }),
  links: z
    .array(
      z.object({
        url: httpUrlSchema,
        title: z.string().trim().max(500).optional(),
      }),
    )
    .min(1)
    .max(CLIP_BATCH_MAX_LINKS),
  note: z
    .string()
    .trim()
    .max(CLIP_BATCH_NOTE_MAX_LENGTH)
    .optional()
    .transform((value) => (value ? value : undefined)),
  /**
   * Leave out links already saved in the user's boards and report them
   * instead (IMP-065). Without it every link is saved and duplicates are only
   * reported.
   */
  skipDuplicates: z.boolean().optional(),
});

export type ClipBatchInput = z.infer<typeof clipBatchSchema>;
