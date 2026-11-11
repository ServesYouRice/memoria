import { ModelProvider } from "@/generated/prisma/client";
import {
  AiUpstreamError,
  joinUrl,
  postForm,
  postJson,
  toBase64,
  type AiProviderAdapter,
  type AiProviderConfig,
} from "./types";

// OpenAI reasoning models reject `max_tokens` and non-default temperatures.
const OPENAI_REASONING_MODEL = /^(o\d|gpt-5)/i;

interface ChatCompletionResponse {
  choices?: Array<{ message?: { content?: string | null } }>;
}

interface TranscriptionResponse {
  text?: string;
}

/**
 * The chat model is not a speech model, so transcription uses its own: OpenAI's
 * current small transcription model, or `whisper-1` (the name local Whisper
 * servers such as LocalAI and speaches answer to). AI_TRANSCRIPTION_MODEL
 * overrides both.
 */
export function transcriptionModelFor(provider: ModelProvider): string {
  const configured = process.env.AI_TRANSCRIPTION_MODEL?.trim();
  if (configured) return configured;
  return provider === ModelProvider.OPENAI
    ? "gpt-4o-mini-transcribe"
    : "whisper-1";
}

interface EmbeddingResponse {
  data?: Array<{ index?: number; embedding?: unknown }>;
}

function authHeaders(config: AiProviderConfig): Record<string, string> {
  const headers: Record<string, string> = {
    authorization: `Bearer ${config.apiKey}`,
  };
  if (config.provider === ModelProvider.OPENROUTER) {
    headers["x-title"] = "Memoria";
  }
  return headers;
}

function messageContent(payload: ChatCompletionResponse): string {
  const content = payload?.choices?.[0]?.message?.content;
  if (typeof content !== "string") {
    throw new AiUpstreamError(
      "openai-compatible",
      200,
      "Response had no message content",
    );
  }
  return content;
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
    speechToText: true,
    readImage: true,
    embeddings: true,
  },
  async generateText(config, request) {
    const isOpenAi = config.provider === ModelProvider.OPENAI;
    const reasoning = isOpenAi && OPENAI_REASONING_MODEL.test(config.model);
    const body: Record<string, unknown> = {
      model: config.model,
      messages: [
        { role: "system", content: request.system },
        ...(request.history ?? []).map(({ role, content }) => ({
          role,
          content,
        })),
        { role: "user", content: request.prompt },
      ],
    };
    if (isOpenAi) body.max_completion_tokens = request.maxTokens;
    else body.max_tokens = request.maxTokens;
    if (!reasoning && request.temperature !== undefined) {
      body.temperature = request.temperature;
    }

    const headers = authHeaders(config);

    const payload = (await postJson(
      "openai-compatible",
      joinUrl(config.baseUrl, "chat/completions"),
      headers,
      body,
      request.signal,
      config.pinnedIp,
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
  async transcribeAudio(config, request) {
    const form = new FormData();
    form.append("model", transcriptionModelFor(config.provider));
    form.append("response_format", "json");
    form.append(
      "file",
      new Blob([new Uint8Array(request.audio)], { type: request.mimeType }),
      request.filename,
    );
    const payload = (await postForm(
      "openai-compatible",
      joinUrl(config.baseUrl, "audio/transcriptions"),
      authHeaders(config),
      form,
      request.signal,
      config.pinnedIp,
    )) as TranscriptionResponse;
    if (typeof payload?.text !== "string") {
      throw new AiUpstreamError(
        "openai-compatible",
        200,
        "Transcription had no text",
      );
    }
    return payload.text;
  },
  async readImage(config, request) {
    const isOpenAi = config.provider === ModelProvider.OPENAI;
    const body: Record<string, unknown> = {
      model: config.model,
      messages: [
        { role: "system", content: request.system },
        {
          role: "user",
          content: [
            { type: "text", text: request.prompt },
            {
              type: "image_url",
              image_url: {
                url: `data:${request.mimeType};base64,${toBase64(request.image)}`,
              },
            },
          ],
        },
      ],
    };
    if (isOpenAi) body.max_completion_tokens = request.maxTokens;
    else body.max_tokens = request.maxTokens;
    const payload = (await postJson(
      "openai-compatible",
      joinUrl(config.baseUrl, "chat/completions"),
      authHeaders(config),
      body,
      request.signal,
      config.pinnedIp,
    )) as ChatCompletionResponse;
    return messageContent(payload);
  },
  async embed(config, request) {
    const payload = (await postJson(
      "openai-compatible",
      joinUrl(config.baseUrl, "embeddings"),
      authHeaders(config),
      { model: request.model, input: request.input },
      request.signal,
      config.pinnedIp,
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
