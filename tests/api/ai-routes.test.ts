import { beforeEach, describe, expect, it, vi } from "vitest";
import { type NextRequest } from "next/server";

const authMocks = vi.hoisted(() => ({
  auth: vi.fn(),
}));

const prismaMocks = vi.hoisted(() => ({
  canvasFindUnique: vi.fn(),
  canvasFindFirst: vi.fn(),
}));

const aiServiceMocks = vi.hoisted(() => ({
  generateText: vi.fn(),
  generateTags: vi.fn(),
  summarizeCanvas: vi.fn(),
  findSerendipitousItems: vi.fn(),
  buildCanvasSummaryContent: vi.fn(),
}));

const aiBudgetMocks = vi.hoisted(() => ({
  runBudgetedAi: vi.fn(),
}));

const usage = {
  enabled: true,
  date: "2026-08-29",
  tokensUsed: 25,
  tokenLimit: 1000,
  costMicroUsdUsed: 2,
  costMicroUsdLimit: 100,
  activeRequests: 1,
  concurrencyLimit: 2,
  requests: 1,
  rejections: 0,
};

vi.mock("@/lib/auth", () => ({
  auth: authMocks.auth,
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    canvas: {
      findUnique: prismaMocks.canvasFindUnique,
      findFirst: prismaMocks.canvasFindFirst,
    },
  },
}));

vi.mock("@/lib/ai/service", () => ({
  generateText: aiServiceMocks.generateText,
  generateTags: aiServiceMocks.generateTags,
  summarizeCanvas: aiServiceMocks.summarizeCanvas,
  buildCanvasSummaryContent: aiServiceMocks.buildCanvasSummaryContent,
  AI_SUMMARY_ITEM_LIMIT: 500,
}));

vi.mock("@/lib/ai/budget", () => ({
  runBudgetedAi: aiBudgetMocks.runBudgetedAi,
}));

vi.mock("@/lib/ai/serendipity-service", () => ({
  findSerendipitousItems: aiServiceMocks.findSerendipitousItems,
}));

import { POST as generatePost } from "@/app/api/v1/ai/generate/route";
import { POST as compatGeneratePost } from "@/app/api/ai/generate/route";
import { POST as chatPost } from "@/app/api/v1/ai/chat/route";
import { POST as tagsPost } from "@/app/api/v1/ai/tags/route";
import { POST as summarizePost } from "@/app/api/v1/ai/summarize/route";
import { POST as serendipityPost } from "@/app/api/v1/ai/serendipity/route";

function createNextRequest(
  url: string,
  options?: {
    method?: string;
    body?: unknown;
  },
): NextRequest {
  const init: RequestInit = {
    method: options?.method || "POST",
    headers: { "Content-Type": "application/json" },
  };
  if (options?.body !== undefined) {
    init.body =
      typeof options.body === "string"
        ? options.body
        : JSON.stringify(options.body);
  }
  const req = new Request(url, init);
  (req as any).nextUrl = new URL(url);
  return req as unknown as NextRequest;
}

describe("AI Route Authorization and Request Boundaries (IMP-064)", () => {
  const sessionUser = {
    id: "user-123",
    email: "user@example.com",
    name: "Test User",
  };
  const validCanvasId = "cjld2cjxh0000qzrmn831i7rn";

  beforeEach(() => {
    vi.clearAllMocks();
    aiServiceMocks.buildCanvasSummaryContent.mockReturnValue("summary prompt");
    aiBudgetMocks.runBudgetedAi.mockImplementation(
      async (
        _userId: string,
        _input: unknown,
        operation: () => Promise<unknown>,
      ) => ({
        value: await operation(),
        usage,
      }),
    );
  });

  describe("Unauthenticated Requests", () => {
    const unauthTestCases = [
      {
        name: "POST /api/v1/ai/generate",
        url: "http://localhost/api/v1/ai/generate",
        handler: generatePost,
        body: { prompt: "Generate idea" },
      },
      {
        name: "POST /api/ai/generate (compat route)",
        url: "http://localhost/api/ai/generate",
        handler: compatGeneratePost,
        body: { prompt: "Generate idea" },
      },
      {
        name: "POST /api/v1/ai/chat",
        url: "http://localhost/api/v1/ai/chat",
        handler: chatPost,
        body: { message: "Hello", persona: "creative" },
      },
      {
        name: "POST /api/v1/ai/tags",
        url: "http://localhost/api/v1/ai/tags",
        handler: tagsPost,
        body: { content: "Sample note content" },
      },
      {
        name: "POST /api/v1/ai/summarize",
        url: "http://localhost/api/v1/ai/summarize",
        handler: summarizePost,
        body: { canvasId: validCanvasId },
      },
      {
        name: "POST /api/v1/ai/serendipity",
        url: "http://localhost/api/v1/ai/serendipity",
        handler: serendipityPost,
        body: { canvasId: validCanvasId, keywords: ["note"] },
      },
    ];

    it.each(unauthTestCases)(
      "rejects $name with 401 when no session exists and invokes zero AI services or Prisma calls",
      async ({ url, handler, body }) => {
        authMocks.auth.mockResolvedValue(null);

        const req = createNextRequest(url, { body });
        const res = await handler(req);

        expect(res.status).toBe(401);
        expect(aiServiceMocks.generateText).not.toHaveBeenCalled();
        expect(aiServiceMocks.generateTags).not.toHaveBeenCalled();
        expect(aiServiceMocks.summarizeCanvas).not.toHaveBeenCalled();
        expect(aiServiceMocks.findSerendipitousItems).not.toHaveBeenCalled();
        expect(prismaMocks.canvasFindUnique).not.toHaveBeenCalled();
        expect(prismaMocks.canvasFindFirst).not.toHaveBeenCalled();
      },
    );
  });

  describe("Schema Validation Boundaries", () => {
    beforeEach(() => {
      authMocks.auth.mockResolvedValue({ user: sessionUser });
    });

    const invalidInputTestCases = [
      {
        description: "empty prompt on generate",
        url: "http://localhost/api/v1/ai/generate",
        handler: generatePost,
        body: { prompt: "" },
      },
      {
        description: "prompt exceeding 5,000 characters on generate",
        url: "http://localhost/api/v1/ai/generate",
        handler: generatePost,
        body: { prompt: "a".repeat(5001) },
      },
      {
        description: "system exceeding 4,000 characters on generate",
        url: "http://localhost/api/v1/ai/generate",
        handler: generatePost,
        body: { prompt: "Valid prompt", system: "s".repeat(4001) },
      },
      {
        description: "temperature below 0 on generate",
        url: "http://localhost/api/v1/ai/generate",
        handler: generatePost,
        body: { prompt: "Valid prompt", temperature: -0.1 },
      },
      {
        description: "temperature above 2 on generate",
        url: "http://localhost/api/v1/ai/generate",
        handler: generatePost,
        body: { prompt: "Valid prompt", temperature: 2.1 },
      },
      {
        description: "empty message on chat",
        url: "http://localhost/api/v1/ai/chat",
        handler: chatPost,
        body: { message: "", persona: "creative" },
      },
      {
        description: "message exceeding 5,000 characters on chat",
        url: "http://localhost/api/v1/ai/chat",
        handler: chatPost,
        body: { message: "m".repeat(5001), persona: "creative" },
      },
      {
        description: "context exceeding 20,000 characters on chat",
        url: "http://localhost/api/v1/ai/chat",
        handler: chatPost,
        body: {
          message: "Valid message",
          persona: "creative",
          context: "c".repeat(20001),
        },
      },
      {
        description: "invalid persona on chat",
        url: "http://localhost/api/v1/ai/chat",
        handler: chatPost,
        body: { message: "Valid message", persona: "invalid_persona" },
      },
      {
        description: "empty content on tags",
        url: "http://localhost/api/v1/ai/tags",
        handler: tagsPost,
        body: { content: "" },
      },
      {
        description: "content exceeding 5,000 characters on tags",
        url: "http://localhost/api/v1/ai/tags",
        handler: tagsPost,
        body: { content: "t".repeat(5001) },
      },
      {
        description: "malformed canvasId (not cuid) on summarize",
        url: "http://localhost/api/v1/ai/summarize",
        handler: summarizePost,
        body: { canvasId: "not-a-valid-cuid" },
      },
      {
        description: "malformed canvasId (not cuid) on serendipity",
        url: "http://localhost/api/v1/ai/serendipity",
        handler: serendipityPost,
        body: { canvasId: "not-a-valid-cuid" },
      },
      {
        description: "more than 20 keywords on serendipity",
        url: "http://localhost/api/v1/ai/serendipity",
        handler: serendipityPost,
        body: {
          canvasId: validCanvasId,
          keywords: Array.from({ length: 21 }, (_, i) => `kw${i}`),
        },
      },
      {
        description: "keyword exceeding 100 characters on serendipity",
        url: "http://localhost/api/v1/ai/serendipity",
        handler: serendipityPost,
        body: { canvasId: validCanvasId, keywords: ["k".repeat(101)] },
      },
      {
        description: "empty keyword string on serendipity",
        url: "http://localhost/api/v1/ai/serendipity",
        handler: serendipityPost,
        body: { canvasId: validCanvasId, keywords: [""] },
      },
    ];

    it.each(invalidInputTestCases)(
      "rejects $description with 400 and makes zero provider or database calls",
      async ({ url, handler, body }) => {
        const req = createNextRequest(url, { body });
        const res = await handler(req);

        expect(res.status).toBe(400);
        expect(aiServiceMocks.generateText).not.toHaveBeenCalled();
        expect(aiServiceMocks.generateTags).not.toHaveBeenCalled();
        expect(aiServiceMocks.summarizeCanvas).not.toHaveBeenCalled();
        expect(aiServiceMocks.findSerendipitousItems).not.toHaveBeenCalled();
        expect(prismaMocks.canvasFindUnique).not.toHaveBeenCalled();
        expect(prismaMocks.canvasFindFirst).not.toHaveBeenCalled();
      },
    );
  });

  describe("Valid Direct AI Routes (Generate, Chat, Tags)", () => {
    beforeEach(() => {
      authMocks.auth.mockResolvedValue({ user: sessionUser });
    });

    it("POST /api/v1/ai/generate passes parsed prompt, system, and temperature to service and returns { result }", async () => {
      aiServiceMocks.generateText.mockResolvedValue("Generated note idea");

      const req = createNextRequest("http://localhost/api/v1/ai/generate", {
        body: {
          prompt: "Write a note about gravity",
          system: "You are a physics expert",
          temperature: 0.8,
        },
      });
      const res = await generatePost(req);

      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({
        result: "Generated note idea",
        usage,
      });
      expect(aiServiceMocks.generateText).toHaveBeenCalledWith({
        prompt: "Write a note about gravity",
        system: "You are a physics expert",
        temperature: 0.8,
        maxTokens: 500,
      });
    });

    it("POST /api/v1/ai/chat builds persona prompt and user context, calls service, and returns { result }", async () => {
      aiServiceMocks.generateText.mockResolvedValue("Creative chat response");

      const req = createNextRequest("http://localhost/api/v1/ai/chat", {
        body: {
          message: "How can I organize my board?",
          context: "Canvas with 5 physics notes",
          persona: "creative",
        },
      });
      const res = await chatPost(req);

      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({
        result: "Creative chat response",
        usage,
      });
      expect(aiServiceMocks.generateText).toHaveBeenCalledWith({
        prompt: "How can I organize my board?",
        system: expect.stringContaining("Canvas with 5 physics notes"),
        maxTokens: 500,
      });
    });

    it("POST /api/v1/ai/tags calls generateTags with content and returns { tags }", async () => {
      aiServiceMocks.generateTags.mockResolvedValue([
        "physics",
        "gravity",
        "science",
      ]);

      const req = createNextRequest("http://localhost/api/v1/ai/tags", {
        body: {
          content: "General relativity describes the geometry of spacetime.",
        },
      });
      const res = await tagsPost(req);

      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({
        tags: ["physics", "gravity", "science"],
        usage,
      });
      expect(aiServiceMocks.generateTags).toHaveBeenCalledWith(
        "General relativity describes the geometry of spacetime.",
      );
    });
  });

  describe("Canvas Ownership Scoped AI Routes (Summarize, Serendipity)", () => {
    beforeEach(() => {
      authMocks.auth.mockResolvedValue({ user: sessionUser });
    });

    describe("POST /api/v1/ai/summarize", () => {
      it("returns 404 when canvas is not found without calling summarizeCanvas", async () => {
        prismaMocks.canvasFindUnique.mockResolvedValue(null);

        const req = createNextRequest("http://localhost/api/v1/ai/summarize", {
          body: { canvasId: validCanvasId },
        });
        const res = await summarizePost(req);

        expect(res.status).toBe(404);
        expect(aiServiceMocks.summarizeCanvas).not.toHaveBeenCalled();
      });

      it("returns 403 when canvas is owned by another user without calling summarizeCanvas", async () => {
        prismaMocks.canvasFindUnique.mockResolvedValue({
          id: validCanvasId,
          userId: "outsider-user-456",
          items: [],
        });

        const req = createNextRequest("http://localhost/api/v1/ai/summarize", {
          body: { canvasId: validCanvasId },
        });
        const res = await summarizePost(req);

        expect(res.status).toBe(403);
        expect(aiServiceMocks.summarizeCanvas).not.toHaveBeenCalled();
      });

      it("queries non-deleted items on owned canvas, passes items to summarizeCanvas, and returns { summary }", async () => {
        const mockItems = [
          {
            id: "item-1",
            content: { text: "Physics note 1" },
            deletedAt: null,
          },
          {
            id: "item-2",
            content: { text: "Physics note 2" },
            deletedAt: null,
          },
        ];

        prismaMocks.canvasFindUnique.mockResolvedValue({
          id: validCanvasId,
          userId: sessionUser.id,
          items: mockItems,
        });
        aiServiceMocks.summarizeCanvas.mockResolvedValue(
          "Executive summary of notes",
        );

        const req = createNextRequest("http://localhost/api/v1/ai/summarize", {
          body: { canvasId: validCanvasId },
        });
        const res = await summarizePost(req);

        expect(res.status).toBe(200);
        expect(await res.json()).toEqual({
          summary: "Executive summary of notes",
          usage,
          itemsConsumed: 2,
        });

        expect(prismaMocks.canvasFindUnique).toHaveBeenCalledWith({
          where: { id: validCanvasId },
          select: {
            id: true,
            userId: true,
            items: {
              where: {
                deletedAt: null,
                type: { in: ["NOTE", "TEXT", "BOOKMARK"] },
              },
              orderBy: [{ zIndex: "asc" }, { id: "asc" }],
              take: 500,
              select: { type: true, content: true },
            },
          },
        });
        expect(aiServiceMocks.summarizeCanvas).toHaveBeenCalledWith(mockItems);
      });
    });

    describe("POST /api/v1/ai/serendipity", () => {
      it("returns 403 when canvas is not owned by current user without calling findSerendipitousItems", async () => {
        prismaMocks.canvasFindFirst.mockResolvedValue(null);

        const req = createNextRequest(
          "http://localhost/api/v1/ai/serendipity",
          {
            body: { canvasId: validCanvasId, keywords: ["physics"] },
          },
        );
        const res = await serendipityPost(req);

        expect(res.status).toBe(403);
        expect(aiServiceMocks.findSerendipitousItems).not.toHaveBeenCalled();
        expect(prismaMocks.canvasFindFirst).toHaveBeenCalledWith({
          where: { id: validCanvasId, userId: sessionUser.id },
          select: { id: true },
        });
      });

      it("invokes findSerendipitousItems with user ID, canvas ID, keywords, and email on owned canvas, returning { results }", async () => {
        prismaMocks.canvasFindFirst.mockResolvedValue({ id: validCanvasId });
        const mockResults = [
          { itemId: "item-10", score: 0.95, text: "Serendipitous match" },
        ];
        aiServiceMocks.findSerendipitousItems.mockResolvedValue(mockResults);

        const req = createNextRequest(
          "http://localhost/api/v1/ai/serendipity",
          {
            body: { canvasId: validCanvasId, keywords: ["quantum", "gravity"] },
          },
        );
        const res = await serendipityPost(req);

        expect(res.status).toBe(200);
        expect(await res.json()).toEqual({ results: mockResults, usage });

        expect(aiServiceMocks.findSerendipitousItems).toHaveBeenCalledWith(
          sessionUser.id,
          validCanvasId,
          ["quantum", "gravity"],
          sessionUser.email,
        );
      });
    });
  });
});
