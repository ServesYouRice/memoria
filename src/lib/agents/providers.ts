import { ModelProvider } from "@/generated/prisma/client";

export interface ProviderSlot {
  provider: ModelProvider;
  label: string;
  supportsByok: boolean;
  defaultBaseUrl?: string;
  capabilityFlags: string[];
  suggestedModels: string[];
}

export const PROVIDER_SLOTS: ProviderSlot[] = [
  {
    provider: ModelProvider.OPENAI,
    label: "OpenAI",
    supportsByok: true,
    defaultBaseUrl: "https://api.openai.com/v1",
    capabilityFlags: ["chat", "reasoning", "embeddings"],
    suggestedModels: ["gpt-5.4", "gpt-5.4-mini"],
  },
  {
    provider: ModelProvider.ANTHROPIC,
    label: "Anthropic",
    supportsByok: true,
    defaultBaseUrl: "https://api.anthropic.com",
    capabilityFlags: ["chat", "reasoning"],
    suggestedModels: ["claude-sonnet-4-5", "claude-opus-4-1"],
  },
  {
    provider: ModelProvider.GEMINI,
    label: "Google Gemini",
    supportsByok: true,
    defaultBaseUrl: "https://generativelanguage.googleapis.com",
    capabilityFlags: ["chat", "reasoning", "embeddings"],
    suggestedModels: ["gemini-2.5-pro", "gemini-2.5-flash"],
  },
  {
    provider: ModelProvider.OPENROUTER,
    label: "OpenRouter",
    supportsByok: true,
    defaultBaseUrl: "https://openrouter.ai/api/v1",
    capabilityFlags: ["chat", "routing"],
    suggestedModels: ["openai/gpt-5", "anthropic/claude-sonnet-4.5"],
  },
  {
    provider: ModelProvider.OPENAI_COMPAT,
    label: "OpenAI-Compatible / Local",
    supportsByok: true,
    capabilityFlags: ["chat", "embeddings"],
    suggestedModels: ["custom"],
  },
];
