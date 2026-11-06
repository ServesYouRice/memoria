import {
  AiUpstreamError,
  joinUrl,
  postJson,
  toBase64,
  type AiProviderAdapter,
  type AiProviderConfig,
} from "./types";

export const ANTHROPIC_API_VERSION = "2023-06-01";

// Claude 5-generation models think by default, reject sampling parameters and
// take an effort level instead. Built-in AI tasks are short, so ask for little
// thinking and keep the reserved output budget for the answer.
const CLAUDE_EFFORT_MODEL = /^claude-(opus|sonnet|haiku|fable)-5/i;

interface MessagesResponse {
  stop_reason?: string | null;
  content?: Array<{ type?: string; text?: string }>;
}

function textFrom(payload: MessagesResponse): string {
  if (payload?.stop_reason === "refusal") {
    throw new AiUpstreamError(
      "anthropic",
      200,
      "The model declined the request",
    );
  }
  if (!Array.isArray(payload?.content)) {
    throw new AiUpstreamError("anthropic", 200, "Response had no content");
  }
  return payload.content
    .filter((block) => block?.type === "text" && typeof block.text === "string")
    .map((block) => block.text)
    .join("");
}

function postMessages(
  config: AiProviderConfig,
  body: Record<string, unknown>,
  signal?: AbortSignal,
) {
  if (CLAUDE_EFFORT_MODEL.test(config.model)) {
    body.output_config = { effort: "low" };
  }
  return postJson(
    "anthropic",
    joinUrl(config.baseUrl, "v1/messages"),
    {
      "x-api-key": config.apiKey,
      "anthropic-version": ANTHROPIC_API_VERSION,
    },
    body,
    signal,
  ) as Promise<MessagesResponse>;
}

/** Anthropic Messages API (`POST /v1/messages`). */
export const anthropicAdapter: AiProviderAdapter = {
  id: "anthropic",
  capabilities: {
    chat: true,
    speechToText: false,
    readImage: true,
    embeddings: false,
  },
  async generateText(config, request) {
    const body: Record<string, unknown> = {
      model: config.model,
      max_tokens: request.maxTokens,
      system: request.system,
      messages: [{ role: "user", content: request.prompt }],
    };
    if (CLAUDE_EFFORT_MODEL.test(config.model)) {
      body.output_config = { effort: "low" };
    }
    // `temperature` is deliberately not sent: current Claude models reject
    // non-default sampling parameters.

    const payload = (await postJson(
      "anthropic",
      joinUrl(config.baseUrl, "v1/messages"),
      {
        "x-api-key": config.apiKey,
        "anthropic-version": ANTHROPIC_API_VERSION,
      },
      body,
      request.signal,
    )) as MessagesResponse;

    if (payload?.stop_reason === "refusal") {
      throw new AiUpstreamError(
        "anthropic",
        200,
        "The model declined the request",
      );
    }
    if (!Array.isArray(payload?.content)) {
      throw new AiUpstreamError("anthropic", 200, "Response had no content");
    }
    return payload.content
      .filter(
        (block) => block?.type === "text" && typeof block.text === "string",
      )
      .map((block) => block.text)
      .join("");
  },
  // Image content blocks; there is no Anthropic speech-to-text endpoint.
  async readImage(config, request) {
    const payload = await postMessages(
      config,
      {
        model: config.model,
        max_tokens: request.maxTokens,
        system: request.system,
        messages: [
          {
            role: "user",
            content: [
              {
                type: "image",
                source: {
                  type: "base64",
                  media_type: request.mimeType,
                  data: toBase64(request.image),
                },
              },
              { type: "text", text: request.prompt },
            ],
          },
        ],
      },
      request.signal,
    );
    return textFrom(payload);
  },
};
