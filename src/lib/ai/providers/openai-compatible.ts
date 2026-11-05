import { ModelProvider } from "@/generated/prisma/client";
import {
  AiUpstreamError,
  joinUrl,
  postJson,
  type AiProviderAdapter,
} from "./types";

// OpenAI reasoning models reject `max_tokens` and non-default temperatures.
const OPENAI_REASONING_MODEL = /^(o\d|gpt-5)/i;

interface ChatCompletionResponse {
  choices?: Array<{ message?: { content?: string | null } }>;
}

/**
 * OpenAI Chat Completions. Gemini, OpenRouter and local/self-hosted servers
 * (Ollama, vLLM, LM Studio) are reached through the same wire format at their
 * OpenAI-compatible base URLs.
 */
export const openAiCompatibleAdapter: AiProviderAdapter = {
  id: "openai-compatible",
  capabilities: {
    chat: true,
    speechToText: false,
    readImage: false,
    embeddings: false,
  },
  async generateText(config, request) {
    const isOpenAi = config.provider === ModelProvider.OPENAI;
    const reasoning = isOpenAi && OPENAI_REASONING_MODEL.test(config.model);
    const body: Record<string, unknown> = {
      model: config.model,
      messages: [
        { role: "system", content: request.system },
        { role: "user", content: request.prompt },
      ],
    };
    if (isOpenAi) body.max_completion_tokens = request.maxTokens;
    else body.max_tokens = request.maxTokens;
    if (!reasoning && request.temperature !== undefined) {
      body.temperature = request.temperature;
    }

    const headers: Record<string, string> = {
      authorization: `Bearer ${config.apiKey}`,
    };
    if (config.provider === ModelProvider.OPENROUTER) {
      headers["x-title"] = "Memoria";
    }

    const payload = (await postJson(
      "openai-compatible",
      joinUrl(config.baseUrl, "chat/completions"),
      headers,
      body,
      request.signal,
    )) as ChatCompletionResponse;
    const content = payload?.choices?.[0]?.message?.content;
    if (typeof content !== "string") {
      throw new AiUpstreamError(
        "openai-compatible",
        200,
        "Response had no message content",
      );
    }
    return content;
  },
};
