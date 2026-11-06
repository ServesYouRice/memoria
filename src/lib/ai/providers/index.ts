import { ModelProvider } from "@/generated/prisma/client";
import { anthropicAdapter } from "./anthropic";
import { openAiCompatibleAdapter } from "./openai-compatible";
import type { AiCapabilities, AiProviderAdapter } from "./types";

export * from "./types";
export { anthropicAdapter } from "./anthropic";
export { openAiCompatibleAdapter } from "./openai-compatible";

/** The one place that maps a provider to its wire format. */
export function getAiAdapter(provider: ModelProvider): AiProviderAdapter {
  return provider === ModelProvider.ANTHROPIC
    ? anthropicAdapter
    : openAiCompatibleAdapter;
}

/**
 * What built-in AI may offer for a provider: the adapter's flags, narrowed
 * where the provider does not serve an endpoint the adapter speaks. Gemini's
 * and OpenRouter's OpenAI-compatible APIs have no `/audio/transcriptions`.
 * A local server (OPENAI_COMPAT) is assumed to serve what the adapter speaks;
 * its owner chooses models that do.
 */
export function getAiCapabilities(provider: ModelProvider): AiCapabilities {
  const capabilities = { ...getAiAdapter(provider).capabilities };
  if (
    provider === ModelProvider.GEMINI ||
    provider === ModelProvider.OPENROUTER
  ) {
    capabilities.speechToText = false;
  }
  return capabilities;
}
