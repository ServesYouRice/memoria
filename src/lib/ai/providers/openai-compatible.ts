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

interface EmbeddingResponse {
  data?: Array<{ index?: number; embedding?: unknown }>;
}

function authHeaders(provider: ModelProvider, apiKey: string) {
  const headers: Record<string, string> = {
    authorization: `Bearer ${apiKey}`,
  };
  if (provider === ModelProvider.OPENROUTER) {
    headers["x-title"] = "Memoria";
  }
  return headers;
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
    embeddings: true,
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

    const headers = authHeaders(config.provider, config.apiKey);

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
  async embed(config, request) {
    const payload = (await postJson(
      "openai-compatible",
      joinUrl(config.baseUrl, "embeddings"),
      authHeaders(config.provider, config.apiKey),
      { model: request.model, input: request.input },
      request.signal,
    )) as EmbeddingResponse;
    const rows = Array.isArray(payload?.data) ? [...payload.data] : [];
    rows.sort((a, b) => (a.index ?? 0) - (b.index ?? 0));
    const vectors = rows.map((row) => row.embedding);
    if (
      vectors.length !== request.input.length ||
      !vectors.every(
        (vector): vector is number[] =>
          Array.isArray(vector) &&
          vector.length > 0 &&
          vector.every((value) => typeof value === "number"),
      )
    ) {
      throw new AiUpstreamError(
        "openai-compatible",
        200,
        "Response had no usable embeddings",
      );
    }
    return vectors;
  },
};
