import { afterEach, describe, expect, it, vi } from "vitest";
import { ModelProvider } from "@/generated/prisma/enums";
import {
  AiUpstreamError,
  anthropicAdapter,
  getAiAdapter,
  getAiCapabilities,
  openAiCompatibleAdapter,
} from "@/lib/ai/providers";
import { ANTHROPIC_API_VERSION } from "@/lib/ai/providers/anthropic";

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", "request-id": "req_1" },
  });
}

function mockFetch(response: Response | Error) {
  const fetchMock = vi.fn(async () => {
    if (response instanceof Error) throw response;
    return response;
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function lastCall(fetchMock: ReturnType<typeof mockFetch>) {
  const [url, init] = fetchMock.mock.calls.at(-1) as unknown as [
    string,
    RequestInit,
  ];
  return {
    url,
    init,
    headers: init.headers as Record<string, string>,
    body: JSON.parse(String(init.body)),
  };
}

const request = {
  prompt: "Tag this",
  system: "You tag",
  temperature: 0.3,
  maxTokens: 80,
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("getAiAdapter", () => {
  it("routes Anthropic to the Messages adapter and every other provider to the OpenAI-compatible one", () => {
    expect(getAiAdapter(ModelProvider.ANTHROPIC)).toBe(anthropicAdapter);
    for (const provider of [
      ModelProvider.OPENAI,
      ModelProvider.GEMINI,
      ModelProvider.OPENROUTER,
      ModelProvider.OPENAI_COMPAT,
    ]) {
      expect(getAiAdapter(provider)).toBe(openAiCompatibleAdapter);
    }
  });

  it("flags speech-to-text and image reading per provider", () => {
    const flags = (provider: ModelProvider) => {
      const { speechToText, readImage } = getAiCapabilities(provider);
      return { speechToText, readImage };
    };
    expect(flags(ModelProvider.ANTHROPIC)).toEqual({
      speechToText: false,
      readImage: true,
    });
    expect(flags(ModelProvider.OPENAI)).toEqual({
      speechToText: true,
      readImage: true,
    });
    expect(flags(ModelProvider.OPENAI_COMPAT)).toEqual({
      speechToText: true,
      readImage: true,
    });
    // No /audio/transcriptions on their OpenAI-compatible APIs.
    expect(flags(ModelProvider.GEMINI)).toEqual({
      speechToText: false,
      readImage: true,
    });
    expect(flags(ModelProvider.OPENROUTER)).toEqual({
      speechToText: false,
      readImage: true,
    });
    expect(getAiCapabilities(ModelProvider.OPENAI).embeddings).toBe(false);
    // A flag is only set where the adapter has the method behind it.
    expect(anthropicAdapter.transcribeAudio).toBeUndefined();
    expect(typeof anthropicAdapter.readImage).toBe("function");
    expect(typeof openAiCompatibleAdapter.transcribeAudio).toBe("function");
    expect(typeof openAiCompatibleAdapter.readImage).toBe("function");
  });
});

describe("openAiCompatibleAdapter", () => {
  it("posts a chat completion with bearer auth and returns the message text", async () => {
    const fetchMock = mockFetch(
      jsonResponse({ choices: [{ message: { content: "a, b" } }] }),
    );

    const result = await openAiCompatibleAdapter.generateText(
      {
        provider: ModelProvider.OPENAI_COMPAT,
        model: "llama3",
        apiKey: "sk-local",
        baseUrl: "https://llm.example.com/v1/",
      },
      request,
    );

    expect(result).toBe("a, b");
    const call = lastCall(fetchMock);
    expect(call.url).toBe("https://llm.example.com/v1/chat/completions");
    expect(call.init.method).toBe("POST");
    expect(call.init.redirect).toBe("error");
    expect(call.headers.authorization).toBe("Bearer sk-local");
    expect(call.body).toEqual({
      model: "llama3",
      messages: [
        { role: "system", content: "You tag" },
        { role: "user", content: "Tag this" },
      ],
      max_tokens: 80,
      temperature: 0.3,
    });
  });

  it("uses max_completion_tokens for OpenAI and drops temperature for reasoning models", async () => {
    const fetchMock = mockFetch(
      jsonResponse({ choices: [{ message: { content: "ok" } }] }),
    );

    await openAiCompatibleAdapter.generateText(
      {
        provider: ModelProvider.OPENAI,
        model: "gpt-5.4-mini",
        apiKey: "sk-openai",
        baseUrl: "https://api.openai.com/v1",
      },
      request,
    );

    const call = lastCall(fetchMock);
    expect(call.url).toBe("https://api.openai.com/v1/chat/completions");
    expect(call.body.max_completion_tokens).toBe(80);
    expect(call.body).not.toHaveProperty("max_tokens");
    expect(call.body).not.toHaveProperty("temperature");
  });

  it("reaches Gemini through its OpenAI-compatible endpoint", async () => {
    const fetchMock = mockFetch(
      jsonResponse({ choices: [{ message: { content: "ok" } }] }),
    );

    await openAiCompatibleAdapter.generateText(
      {
        provider: ModelProvider.GEMINI,
        model: "gemini-2.5-flash",
        apiKey: "g-key",
        baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai",
      },
      request,
    );

    expect(lastCall(fetchMock).url).toBe(
      "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions",
    );
  });

  it("raises an upstream error with the status and never the body", async () => {
    mockFetch(jsonResponse({ error: { message: "echo: secret prompt" } }, 401));

    const error = await openAiCompatibleAdapter
      .generateText(
        {
          provider: ModelProvider.OPENROUTER,
          model: "openai/gpt-5.4",
          apiKey: "bad",
          baseUrl: "https://openrouter.ai/api/v1",
        },
        request,
      )
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(AiUpstreamError);
    expect((error as AiUpstreamError).status).toBe(401);
    expect((error as AiUpstreamError).authFailed).toBe(true);
    expect((error as AiUpstreamError).providerRequestId).toBe("req_1");
    expect((error as Error).message).not.toContain("secret prompt");
  });

  it("wraps network failures", async () => {
    mockFetch(new TypeError("fetch failed"));
    await expect(
      openAiCompatibleAdapter.generateText(
        {
          provider: ModelProvider.OPENAI,
          model: "gpt-4o-mini",
          apiKey: "k",
          baseUrl: "https://api.openai.com/v1",
        },
        request,
      ),
    ).rejects.toMatchObject({ name: "AiUpstreamError", status: 0 });
  });
});

describe("anthropicAdapter", () => {
  const config = {
    provider: ModelProvider.ANTHROPIC,
    model: "claude-sonnet-5-5",
    apiKey: "sk-ant-test",
    baseUrl: "https://api.anthropic.com",
  };

  it("posts to the Messages API with x-api-key and version headers", async () => {
    const fetchMock = mockFetch(
      jsonResponse({
        stop_reason: "end_turn",
        content: [
          { type: "thinking", thinking: "" },
          { type: "text", text: "physics, " },
          { type: "text", text: "gravity" },
        ],
      }),
    );

    const result = await anthropicAdapter.generateText(config, request);

    expect(result).toBe("physics, gravity");
    const call = lastCall(fetchMock);
    expect(call.url).toBe("https://api.anthropic.com/v1/messages");
    expect(call.headers["x-api-key"]).toBe("sk-ant-test");
    expect(call.headers["anthropic-version"]).toBe(ANTHROPIC_API_VERSION);
    expect(call.headers).not.toHaveProperty("authorization");
    expect(call.body).toEqual({
      model: "claude-sonnet-5-5",
      max_tokens: 80,
      system: "You tag",
      messages: [{ role: "user", content: "Tag this" }],
      output_config: { effort: "low" },
    });
  });

  it("does not send an effort level to models that predate it", async () => {
    const fetchMock = mockFetch(
      jsonResponse({ content: [{ type: "text", text: "ok" }] }),
    );
    await anthropicAdapter.generateText(
      { ...config, model: "claude-haiku-4-5" },
      request,
    );
    expect(lastCall(fetchMock).body).not.toHaveProperty("output_config");
  });

  it("treats a refusal as an upstream error", async () => {
    mockFetch(jsonResponse({ stop_reason: "refusal", content: [] }));
    await expect(
      anthropicAdapter.generateText(config, request),
    ).rejects.toBeInstanceOf(AiUpstreamError);
  });

  it("surfaces HTTP failures as upstream errors", async () => {
    mockFetch(jsonResponse({ type: "error" }, 529));
    await expect(
      anthropicAdapter.generateText(config, request),
    ).rejects.toMatchObject({ status: 529, authFailed: false });
  });
});

const image = {
  image: new Uint8Array([0x89, 0x50, 0x4e, 0x47]),
  mimeType: "image/png",
  prompt: "Read this",
  system: "You read",
  maxTokens: 900,
};

describe("speech-to-text and image reading", () => {
  const openAiConfig = {
    provider: ModelProvider.OPENAI,
    model: "gpt-4o-mini",
    apiKey: "sk-user",
    baseUrl: "https://api.openai.com/v1",
  };

  afterEach(() => {
    delete process.env.AI_TRANSCRIPTION_MODEL;
  });

  it("transcribes through multipart /audio/transcriptions with a speech model", async () => {
    const fetchMock = mockFetch(jsonResponse({ text: "buy milk" }));
    const text = await openAiCompatibleAdapter.transcribeAudio!(openAiConfig, {
      audio: new Uint8Array([0x1a, 0x45, 0xdf, 0xa3]),
      mimeType: "audio/webm",
      filename: "voice-note.webm",
    });
    expect(text).toBe("buy milk");
    const [url, init] = fetchMock.mock.calls.at(-1) as unknown as [
      string,
      RequestInit,
    ];
    expect(url).toBe("https://api.openai.com/v1/audio/transcriptions");
    expect((init.headers as Record<string, string>).authorization).toBe(
      "Bearer sk-user",
    );
    // fetch sets the multipart boundary itself.
    expect(
      (init.headers as Record<string, string>)["content-type"],
    ).toBeUndefined();
    const form = init.body as FormData;
    expect(form.get("model")).toBe("gpt-4o-mini-transcribe");
    const file = form.get("file") as File;
    expect(file.name).toBe("voice-note.webm");
    expect(file.type).toBe("audio/webm");
    expect(file.size).toBe(4);
  });

  it("uses whisper-1 for local servers unless AI_TRANSCRIPTION_MODEL is set", async () => {
    const fetchMock = mockFetch(jsonResponse({ text: "x" }));
    const local = {
      ...openAiConfig,
      provider: ModelProvider.OPENAI_COMPAT,
      baseUrl: "http://whisper.local/v1/",
    };
    const audio = {
      audio: new Uint8Array([1, 2]),
      mimeType: "audio/ogg",
      filename: "a.ogg",
    };
    await openAiCompatibleAdapter.transcribeAudio!(local, audio);
    let [url, init] = fetchMock.mock.calls.at(-1) as unknown as [
      string,
      RequestInit,
    ];
    expect(url).toBe("http://whisper.local/v1/audio/transcriptions");
    expect((init.body as FormData).get("model")).toBe("whisper-1");

    process.env.AI_TRANSCRIPTION_MODEL = "large-v3";
    mockFetch(jsonResponse({ text: "x" }));
    await openAiCompatibleAdapter.transcribeAudio!(local, audio);
    [url, init] = vi.mocked(fetch).mock.calls.at(-1) as unknown as [
      string,
      RequestInit,
    ];
    expect((init.body as FormData).get("model")).toBe("large-v3");
  });

  it("rejects a transcription response without text", async () => {
    mockFetch(jsonResponse({ segments: [] }));
    await expect(
      openAiCompatibleAdapter.transcribeAudio!(openAiConfig, {
        audio: new Uint8Array([1]),
        mimeType: "audio/mpeg",
        filename: "a.mp3",
      }),
    ).rejects.toBeInstanceOf(AiUpstreamError);
  });

  it("reads an image as an image_url data URL in the chat messages", async () => {
    const fetchMock = mockFetch(
      jsonResponse({ choices: [{ message: { content: "Receipt\n\n- tea" } }] }),
    );
    await expect(
      openAiCompatibleAdapter.readImage!(openAiConfig, image),
    ).resolves.toBe("Receipt\n\n- tea");
    const call = lastCall(fetchMock);
    expect(call.url).toBe("https://api.openai.com/v1/chat/completions");
    expect(call.body.max_completion_tokens).toBe(900);
    expect(call.body.messages[0]).toEqual({
      role: "system",
      content: "You read",
    });
    expect(call.body.messages[1].content).toEqual([
      { type: "text", text: "Read this" },
      {
        type: "image_url",
        image_url: { url: "data:image/png;base64,iVBORw==" },
      },
    ]);
  });

  it("reads an image with an Anthropic base64 image content block", async () => {
    const fetchMock = mockFetch(
      jsonResponse({
        stop_reason: "end_turn",
        content: [{ type: "text", text: "Whiteboard\n\nPlan" }],
      }),
    );
    const text = await anthropicAdapter.readImage!(
      {
        provider: ModelProvider.ANTHROPIC,
        model: "claude-haiku-5-5",
        apiKey: "sk-ant",
        baseUrl: "https://api.anthropic.com",
      },
      image,
    );
    expect(text).toBe("Whiteboard\n\nPlan");
    const call = lastCall(fetchMock);
    expect(call.url).toBe("https://api.anthropic.com/v1/messages");
    expect(call.headers["x-api-key"]).toBe("sk-ant");
    expect(call.body.system).toBe("You read");
    expect(call.body.max_tokens).toBe(900);
    expect(call.body.output_config).toEqual({ effort: "low" });
    expect(call.body.messages[0].content).toEqual([
      {
        type: "image",
        source: { type: "base64", media_type: "image/png", data: "iVBORw==" },
      },
      { type: "text", text: "Read this" },
    ]);
  });
});
