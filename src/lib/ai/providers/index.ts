import { ModelProvider } from "@/generated/prisma/client";
import { anthropicAdapter } from "./anthropic";
import { openAiCompatibleAdapter } from "./openai-compatible";
import type { AiProviderAdapter } from "./types";

export * from "./types";
export { anthropicAdapter } from "./anthropic";
export { openAiCompatibleAdapter } from "./openai-compatible";

/** The one place that maps a provider to its wire format. */
export function getAiAdapter(provider: ModelProvider): AiProviderAdapter {
  return provider === ModelProvider.ANTHROPIC
    ? anthropicAdapter
    : openAiCompatibleAdapter;
}
