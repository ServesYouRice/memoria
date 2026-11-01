import { z } from "zod";
import { MAX_EMBED_TTL_DAYS } from "./service";
import { MAX_EMBED_ORIGINS, normalizeEmbedOrigins } from "./origins";

export const createEmbedSchema = z
  .object({
    label: z.string().trim().max(100).default(""),
    allowedOrigins: z
      .array(z.string().max(255))
      .min(1, "Provide at least one allowed origin")
      .max(MAX_EMBED_ORIGINS),
    expiresInDays: z.number().int().min(1).max(MAX_EMBED_TTL_DAYS).optional(),
  })
  .strict()
  .transform((value, ctx) => {
    const allowedOrigins = normalizeEmbedOrigins(value.allowedOrigins);
    if (!allowedOrigins) {
      ctx.addIssue({
        code: "custom",
        path: ["allowedOrigins"],
        message:
          "Each origin must be an exact https origin such as https://example.com (no paths or wildcards)",
      });
      return z.NEVER;
    }
    return { ...value, allowedOrigins };
  });

export type CreateEmbedInput = z.output<typeof createEmbedSchema>;
