import { afterEach, describe, expect, it, vi } from "vitest";
import { ModelProvider } from "@/generated/prisma/enums";
import {
  AiUpstreamError,
  anthropicAdapter,
  getAiAdapter,
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

  it("declares optional capabilities, claiming only what is implemented", () => {
    expect(anthropicAdapter.capabilities).toEqual({
      chat: true,
      speechToText: false,
      readImage: false,
      embeddings: false,
    });
    expect(anthropicAdapter.embed).toBeUndefined();
    // Embeddings back near-duplicate links (IMP-065).
    expect(openAiCompatibleAdapter.capabilities).toEqual({
      chat: true,
      speechToText: false,
      readImage: false,
      embeddings: true,
    });
    expect(typeof openAiCompatibleAdapter.embed).toBe("function");
  });
});

describe("openAiCompatibleAdapter.embed", () => {
  const config = {
    provider: ModelProvider.OPENAI,
    model: "gpt-4o-mini",
    apiKey: "sk-test",
    baseUrl: "https://api.openai.com/v1",
  };

  it("posts the input to /embeddings with the embedding model", async () => {
    const fetchMock = mockFetch(
      jsonResponse({
        data: [
          { index: 1, embedding: [0, 1] },
          { index: 0, embedding: [1, 0] },
        ],
      }),
    );
    await expect(
      openAiCompatibleAdapter.embed!(config, {
        model: "text-embedding-3-small",
        input: ["a", "b"],
      }),
    ).resolves.toEqual([
      [1, 0],
      [0, 1],
    ]);
    const call = lastCall(fetchMock);
    expect(call.url).toBe("https://api.openai.com/v1/embeddings");
    expect(call.headers.authorization).toBe("Bearer sk-test");
    expect(call.body).toEqual({
      model: "text-embedding-3-small",
      input: ["a", "b"],
    });
  });

  it("rejects a response without one vector per input", async () => {
    mockFetch(jsonResponse({ data: [{ index: 0, embedding: "nope" }] }));
    await expect(
      openAiCompatibleAdapter.embed!(config, { model: "m", input: ["a"] }),
    ).rejects.toBeInstanceOf(AiUpstreamError);
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
