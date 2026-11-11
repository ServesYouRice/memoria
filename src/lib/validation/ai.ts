import { z } from "zod";
import { ModelProvider } from "@/generated/prisma/enums";

export const tagSchema = z.object({
  content: z.string().min(1).max(5000),
});

/** Longest canvas context one chat request may carry. */
export const CHAT_CONTEXT_MAX_CHARS = 8_000;
const CONTEXT_TRUNCATED_MARKER = "\n…(truncated)";

/**
 * Cuts chat context to the schema limit, at a line or word boundary where
 * one is near, with a marker counted inside the limit. Text that fits is
 * returned unchanged.
 */
export function boundChatContext(
  text: string,
  max: number = CHAT_CONTEXT_MAX_CHARS,
): string {
  if (text.length <= max) return text;
  const room = Math.max(0, max - CONTEXT_TRUNCATED_MARKER.length);
  let cut = text.slice(0, room);
  const boundary = Math.max(cut.lastIndexOf("\n"), cut.lastIndexOf(" "));
  if (boundary > room * 0.8) cut = cut.slice(0, boundary);
  return `${cut.trimEnd()}${CONTEXT_TRUNCATED_MARKER}`;
}

export const chatSchema = z.object({
  message: z.string().min(1).max(5000),
  context: z.string().max(CHAT_CONTEXT_MAX_CHARS).optional(),
  persona: z.enum(["creative", "socratic", "architect"]),
});

export const serendipitySchema = z.object({
  canvasId: z.string().cuid(),
  keywords: z.array(z.string().min(1).max(100)).max(20).optional(),
});

export const generateSchema = z.object({
  prompt: z.string().min(1).max(5000),
  system: z.string().max(4000).optional(),
  temperature: z.number().min(0).max(2).optional(),
});

export const summarizeSchema = z.object({
  canvasId: z.string().cuid(),
});

export const aiProviderSettingsSchema = z
  .object({
    provider: z.nativeEnum(ModelProvider),
    model: z.string().trim().min(1).max(160),
    baseUrl: z.string().trim().url().max(2048).optional().nullable(),
    // Omit to keep the saved key (only when the provider is unchanged).
    apiKey: z.string().trim().min(1).max(4096).optional(),
  })
  .strict()
  .refine(
    (value) =>
      value.provider !== ModelProvider.OPENAI_COMPAT || !!value.baseUrl,
    {
      message: "An OpenAI-compatible provider needs a base URL.",
      path: ["baseUrl"],
    },
  );
