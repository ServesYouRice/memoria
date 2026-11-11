import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type NextRequest } from "next/server";
import { ModelProvider } from "@/generated/prisma/enums";

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  generateText: vi.fn(),
  runBudgetedAi: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({ auth: mocks.auth }));
vi.mock("@/lib/ai/service", () => ({ generateText: mocks.generateText }));
vi.mock("@/lib/ai/budget", () => ({ runBudgetedAi: mocks.runBudgetedAi }));

import { POST as chatPost } from "@/app/api/v1/ai/chat/route";
import { anthropicAdapter, openAiCompatibleAdapter } from "@/lib/ai/providers";
import * as chatHistory from "@/lib/ai/chat-history";

const MAX_TURNS =
  ((chatHistory as Record<string, unknown>).AI_CHAT_HISTORY_MAX_TURNS as
    number | undefined) ?? 20;

function chatRequest(body: unknown): NextRequest {
  const url = "http://localhost/api/v1/ai/chat";
  const req = new Request(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  (req as any).nextUrl = new URL(url);
  return req as unknown as NextRequest;
}

const history = [
  { role: "user", content: "Name a colour" },
  { role: "assistant", content: "Teal" },
] as const;

describe("chat route history", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.auth.mockResolvedValue({
      user: { id: "user-1", email: "u@example.com" },
    });
    mocks.generateText.mockResolvedValue("Darker: navy");
    mocks.runBudgetedAi.mockImplementation(
      async (_userId: string, _estimate: unknown, run: () => unknown) => ({
        value: await run(),
        usage: {},
      }),
    );
  });

  it("forwards earlier turns and counts them in the budget", async () => {
    const res = await chatPost(
      chatRequest({
        message: "A darker one?",
        persona: "creative",
        history,
      }),
    );
    expect(res.status).toBe(200);
    expect(mocks.generateText).toHaveBeenCalledWith(
      expect.objectContaining({
        prompt: "A darker one?",
        history: [
          { role: "user", content: "Name a colour" },
          { role: "assistant", content: "Teal" },
        ],
      }),
    );
    const estimate = mocks.runBudgetedAi.mock.calls[0]![1] as {
      prompt: string;
    };
    expect(estimate.prompt).toContain("Name a colour");
    expect(estimate.prompt).toContain("Teal");
    expect(estimate.prompt).toContain("A darker one?");
  });

  it("accepts history at the cap and rejects history over it", async () => {
    const turns = (count: number) =>
      Array.from({ length: count }, (_, index) => ({
        role: index % 2 === 0 ? "user" : "assistant",
        content: `turn ${index}`,
      }));
    const atCap = await chatPost(
      chatRequest({
        message: "Hi",
        persona: "creative",
        history: turns(MAX_TURNS),
      }),
    );
    expect(atCap.status).toBe(200);
    const over = await chatPost(
      chatRequest({
        message: "Hi",
        persona: "creative",
        history: turns(MAX_TURNS + 1),
      }),
    );
    expect(over.status).toBe(400);
  });
});

describe("adapters send history as ordered role messages", () => {
  function mockFetch(body: unknown) {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify(body)));
    vi.stubGlobal("fetch", fetchMock);
    return fetchMock;
  }
  const sentBody = (fetchMock: ReturnType<typeof mockFetch>) =>
    JSON.parse(
      String(
        (fetchMock.mock.calls.at(-1) as unknown as [string, RequestInit])[1]
          .body,
      ),
    );

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("OpenAI-compatible: system, prior turns, then the new message", async () => {
    const fetchMock = mockFetch({ choices: [{ message: { content: "ok" } }] });
    await openAiCompatibleAdapter.generateText(
      {
        provider: ModelProvider.OPENAI_COMPAT,
        model: "llama3",
        apiKey: "k",
        baseUrl: "https://llm.example.com/v1",
      },
      {
        prompt: "A darker one?",
        system: "Be brief",
        maxTokens: 50,
        history: [...history],
      } as never,
    );
    expect(sentBody(fetchMock).messages).toEqual([
      { role: "system", content: "Be brief" },
      { role: "user", content: "Name a colour" },
      { role: "assistant", content: "Teal" },
      { role: "user", content: "A darker one?" },
    ]);
  });

  it("Anthropic: alternating turns that start with the user", async () => {
    const fetchMock = mockFetch({
      stop_reason: "end_turn",
      content: [{ type: "text", text: "ok" }],
    });
    await anthropicAdapter.generateText(
      {
        provider: ModelProvider.ANTHROPIC,
        model: "claude-haiku-4-5",
        apiKey: "k",
        baseUrl: "https://api.anthropic.com",
      },
      {
        prompt: "A darker one?",
        system: "Be brief",
        maxTokens: 50,
        history: [
          { role: "assistant", content: "Hello! Ask me anything." },
          { role: "user", content: "Name a colour" },
          { role: "user", content: "Any colour" },
          { role: "assistant", content: "Teal" },
          { role: "user", content: "Unanswered" },
        ],
      } as never,
    );
    expect(sentBody(fetchMock).messages).toEqual([
      { role: "user", content: "Name a colour\n\nAny colour" },
      { role: "assistant", content: "Teal" },
      { role: "user", content: "Unanswered\n\nA darker one?" },
    ]);
  });
});
