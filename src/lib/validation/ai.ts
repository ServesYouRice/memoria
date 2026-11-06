import { z } from "zod";
import { ModelProvider } from "@/generated/prisma/enums";

export const tagSchema = z.object({
  content: z.string().min(1).max(5000),
});

export const chatSchema = z.object({
  message: z.string().min(1).max(5000),
  context: z.string().max(8_000).optional(),
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
