import { ModelProvider } from "@/generated/prisma/client";

export interface ProviderSlot {
  provider: ModelProvider;
  label: string;
  supportsByok: boolean;
  /**
   * Base URL the built-in AI adapter calls when a credential has none. Gemini
   * and OpenRouter point at their OpenAI-compatible endpoints.
   */
  defaultBaseUrl?: string;
  /** True when the owner must supply a base URL (local/self-hosted). */
  requiresBaseUrl?: boolean;
  capabilityFlags: string[];
  /** First entry is the default offered in Settings. */
  suggestedModels: string[];
}

export const PROVIDER_SLOTS: ProviderSlot[] = [
  {
    provider: ModelProvider.ANTHROPIC,
    label: "Anthropic (Claude)",
    supportsByok: true,
    defaultBaseUrl: "https://api.anthropic.com",
    capabilityFlags: ["chat", "reasoning"],
    suggestedModels: [
      "claude-sonnet-5-5",
      "claude-opus-5-5",
      "claude-haiku-5-5",
    ],
  },
  {
    provider: ModelProvider.OPENAI,
    label: "OpenAI",
    supportsByok: true,
    defaultBaseUrl: "https://api.openai.com/v1",
    capabilityFlags: ["chat", "reasoning", "embeddings"],
    suggestedModels: ["gpt-5.4-mini", "gpt-5.4"],
  },
  {
    provider: ModelProvider.GEMINI,
    label: "Google Gemini",
    supportsByok: true,
    defaultBaseUrl: "https://generativelanguage.googleapis.com/v1beta/openai",
    capabilityFlags: ["chat", "reasoning", "embeddings"],
    suggestedModels: ["gemini-2.5-flash", "gemini-2.5-pro"],
  },
  {
    provider: ModelProvider.OPENROUTER,
    label: "OpenRouter",
    supportsByok: true,
    defaultBaseUrl: "https://openrouter.ai/api/v1",
    capabilityFlags: ["chat", "routing"],
    suggestedModels: ["anthropic/claude-sonnet-5.5", "openai/gpt-5.4"],
  },
  {
    provider: ModelProvider.OPENAI_COMPAT,
    label: "OpenAI-Compatible / Local",
    supportsByok: true,
    requiresBaseUrl: true,
    capabilityFlags: ["chat", "embeddings"],
    suggestedModels: ["custom"],
  },
];

export function getProviderSlot(provider: ModelProvider): ProviderSlot {
  const slot = PROVIDER_SLOTS.find((entry) => entry.provider === provider);
  if (!slot) throw new Error(`Unknown model provider: ${provider}`);
  return slot;
}
