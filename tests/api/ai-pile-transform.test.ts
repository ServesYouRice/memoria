import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type NextRequest } from "next/server";
import { ForbiddenError } from "@/lib/errors";

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  requireCanvasAccess: vi.fn(),
  frameFindFirst: vi.fn(),
  itemFindMany: vi.fn(),
  itemCreate: vi.fn(),
  itemAggregate: vi.fn(),
  lockCanvasForMutation: vi.fn(),
  assertCanvasItemCapacity: vi.fn(),
  recordCanvasItemEvent: vi.fn(),
  invalidateCanvasCache: vi.fn(),
  logActivity: vi.fn(),
  generateText: vi.fn(),
  getAiAvailability: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({ auth: mocks.auth }));
vi.mock("@/lib/api/auth", () => ({
  requireCanvasAccess: mocks.requireCanvasAccess,
}));
vi.mock("@/lib/db", () => {
  const canvasItem = {
    findFirst: mocks.frameFindFirst,
    findMany: mocks.itemFindMany,
    create: mocks.itemCreate,
    aggregate: mocks.itemAggregate,
  };
  return {
    prisma: {
      canvasItem,
      $transaction: async (fn: (tx: unknown) => unknown) => fn({ canvasItem }),
    },
  };
});
vi.mock("@/lib/canvas/mutation-lock", () => ({
  lockCanvasForMutation: mocks.lockCanvasForMutation,
}));
vi.mock("@/lib/policy/capacity", () => ({
  assertCanvasItemCapacity: mocks.assertCanvasItemCapacity,
}));
vi.mock("@/lib/collaboration/committed-events", () => ({
  recordCanvasItemEvent: mocks.recordCanvasItemEvent,
}));
vi.mock("@/lib/cache/canvas-cache", () => ({
  invalidateCanvasCache: mocks.invalidateCanvasCache,
}));
vi.mock("@/lib/activity", () => ({
  ActivityType: { ITEM_CREATED: "ITEM_CREATED" },
  logActivity: mocks.logActivity,
}));
vi.mock("@/lib/ai/service", () => ({
  AI_SUMMARY_ITEM_LIMIT: 3,
  AI_SUMMARY_CONTENT_BYTES: 200,
  generateText: mocks.generateText,
}));
vi.mock("@/lib/ai/provider-resolution", () => ({
  AI_NOT_CONFIGURED_DETAIL: "AI not configured.",
  getAiAvailability: mocks.getAiAvailability,
}));

import { POST } from "@/app/api/v1/ai/summarize/pile/route";
import { resetAiBudgetForTests } from "@/lib/ai/budget";
import {
  buildPileContent,
  buildPileNoteDocument,
  parsePipeTable,
} from "@/lib/ai/pile-transform";
import { normalizeNoteContent } from "@/lib/rich-text/note-format";

const canvasId = "cjld2cjxh0000qzrmn831i7rn";
const frameId = "cjld2cjxh0001qzrmn831i7rn";
const user = { id: "user-1", email: "user@example.com", name: "User" };

const frame = {
  id: frameId,
  positionX: 100,
  positionY: 200,
  width: 400,
  height: 300,
  content: { title: "Laptops" },
};
const pileItems = [
  {
    type: "NOTE",
    content: { plainText: "Model A is light", text: "<p>x</p>" },
  },
  { type: "TEXT", content: { text: "Model B has a long battery" } },
  {
    type: "BOOKMARK",
    content: { title: "Review", url: "https://example.com" },
  },
];

function request(body: unknown): NextRequest {
  const url = "http://localhost/api/v1/ai/summarize/pile";
  const req = new Request(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  (req as any).nextUrl = new URL(url);
  return req as unknown as NextRequest;
}

describe("POST /api/v1/ai/summarize/pile (IMP-069)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetAiBudgetForTests();
    vi.stubEnv("REDIS_URL", "");
    vi.stubEnv("AI_ENABLED", "true");
    mocks.auth.mockResolvedValue({ user });
    mocks.requireCanvasAccess.mockResolvedValue("EDIT");
    mocks.frameFindFirst.mockResolvedValue(frame);
    mocks.itemFindMany.mockResolvedValue(pileItems);
    mocks.itemAggregate.mockResolvedValue({ _max: { zIndex: 7 } });
    mocks.getAiAvailability.mockResolvedValue({ configured: true });
    mocks.itemCreate.mockImplementation(async ({ data }) => ({
      id: "new-note",
      version: 1,
      ...data,
    }));
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    resetAiBudgetForTests();
  });

  it("creates a summary note next to the pile without touching its items", async () => {
    mocks.generateText.mockResolvedValue(
      "Two light laptops.\n\nB lasts longer.",
    );
    const response = await POST(
      request({ canvasId, frameId, kind: "summary" }),
      undefined,
    );
    expect(response.status).toBe(201);
    const body = await response.json();
    expect(body.kind).toBe("summary");
    expect(body.itemsConsumed).toBe(3);
    expect(body.usage.requests).toBe(1);

    const { data } = mocks.itemCreate.mock.calls[0][0];
    expect(data).toMatchObject({
      canvasId,
      type: "NOTE",
      positionX: 540,
      positionY: 200,
      zIndex: 8,
      createdById: user.id,
    });
    expect(data.content.plainText).toContain("Summary: Laptops");
    expect(data.content.plainText).toContain("B lasts longer.");
    expect(data.content.document.content[1].type).toBe("paragraph");

    // Only reads and one create: no update/delete exists on the mock.
    expect(mocks.itemCreate).toHaveBeenCalledTimes(1);
    expect(mocks.lockCanvasForMutation).toHaveBeenCalled();
    expect(mocks.assertCanvasItemCapacity).toHaveBeenCalled();
    expect(mocks.recordCanvasItemEvent).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ itemId: "new-note", operation: "created" }),
    );
    expect(mocks.requireCanvasAccess).toHaveBeenCalledWith(
      canvasId,
      user.id,
      user.email,
      "EDIT",
    );

    const prompt = mocks.generateText.mock.calls[0][0];
    expect(prompt.userId).toBe(user.id);
    expect(prompt.prompt).toContain("Note: Model A is light");
    expect(prompt.prompt).toContain("Bookmark: Review");
  });

  it("creates a checklist note from a mocked provider", async () => {
    mocks.generateText.mockResolvedValue(
      "- Compare weight\n2. Check battery\n[ ] Read review\n\n",
    );
    const response = await POST(
      request({ canvasId, frameId, kind: "checklist" }),
      undefined,
    );
    expect(response.status).toBe(201);
    const { data } = mocks.itemCreate.mock.calls[0][0];
    const list = data.content.document.content[1];
    expect(list.type).toBe("bulletList");
    expect(list.content).toHaveLength(3);
    expect(data.content.plainText).toContain("☐ Compare weight");
    expect(data.content.plainText).toContain("☐ Check battery");
    expect(data.content.plainText).toContain("☐ Read review");
  });

  it("creates a comparison table note from a mocked provider", async () => {
    mocks.generateText.mockResolvedValue(
      "| Model | Weight | Battery |\n|---|---|---|\n| A | 1.1 kg | 8 h |\n| B | 1.6 kg | 14 h |",
    );
    const response = await POST(
      request({ canvasId, frameId, kind: "table" }),
      undefined,
    );
    expect(response.status).toBe(201);
    const { data } = mocks.itemCreate.mock.calls[0][0];
    const block = data.content.document.content[1];
    expect(block.type).toBe("codeBlock");
    const lines = block.content[0].text.split("\n");
    expect(lines[0]).toBe("| Model | Weight | Battery |");
    expect(lines[2]).toBe("| A     | 1.1 kg | 8 h     |");
    expect(lines).toHaveLength(4);
  });

  it("rejects a table answer that is not a table without creating a note", async () => {
    mocks.generateText.mockResolvedValue("Sorry, I cannot help.");
    const response = await POST(
      request({ canvasId, frameId, kind: "table" }),
      undefined,
    );
    expect(response.status).toBe(502);
    expect(mocks.itemCreate).not.toHaveBeenCalled();
  });

  it("validates the body with Zod", async () => {
    const response = await POST(
      request({ canvasId, frameId, kind: "poem" }),
      undefined,
    );
    expect(response.status).toBe(400);
    expect(mocks.generateText).not.toHaveBeenCalled();
  });

  it("requires EDIT access before reading the pile", async () => {
    mocks.requireCanvasAccess.mockRejectedValue(new ForbiddenError());
    const response = await POST(
      request({ canvasId, frameId, kind: "summary" }),
      undefined,
    );
    expect(response.status).toBe(403);
    expect(mocks.frameFindFirst).not.toHaveBeenCalled();
    expect(mocks.generateText).not.toHaveBeenCalled();
  });

  it("re-checks EDIT access inside the write transaction", async () => {
    mocks.generateText.mockResolvedValue("A summary.");
    mocks.requireCanvasAccess
      .mockResolvedValueOnce("EDIT")
      .mockRejectedValueOnce(new ForbiddenError());
    const response = await POST(
      request({ canvasId, frameId, kind: "summary" }),
      undefined,
    );
    expect(response.status).toBe(403);
    expect(mocks.itemCreate).not.toHaveBeenCalled();
  });

  it("returns 404 for a missing frame", async () => {
    mocks.frameFindFirst.mockResolvedValue(null);
    const response = await POST(
      request({ canvasId, frameId, kind: "summary" }),
      undefined,
    );
    expect(response.status).toBe(404);
  });

  it("returns 503 without spending budget when AI is not configured", async () => {
    mocks.getAiAvailability.mockResolvedValue({ configured: false });
    const response = await POST(
      request({ canvasId, frameId, kind: "summary" }),
      undefined,
    );
    expect(response.status).toBe(503);
    expect(mocks.generateText).not.toHaveBeenCalled();
  });

  it("applies the AI budget", async () => {
    vi.stubEnv("AI_DAILY_TOKEN_BUDGET", "10");
    mocks.generateText.mockResolvedValue("A summary.");
    const response = await POST(
      request({ canvasId, frameId, kind: "summary" }),
      undefined,
    );
    expect(response.status).toBe(429);
    expect(mocks.generateText).not.toHaveBeenCalled();
    expect(mocks.itemCreate).not.toHaveBeenCalled();
  });

  it("caps the items read by AI_SUMMARY_ITEM_LIMIT", async () => {
    mocks.generateText.mockResolvedValue("A summary.");
    await POST(request({ canvasId, frameId, kind: "summary" }), undefined);
    expect(mocks.itemFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ take: 3 }),
    );
  });
});

describe("pile transform helpers", () => {
  it("caps pile content by item count and UTF-8 bytes", () => {
    const items = Array.from({ length: 10 }, (_, index) => ({
      type: "TEXT",
      content: { text: `item ${index} ${"é".repeat(40)}` },
    }));
    const content = buildPileContent(items);
    expect(Buffer.byteLength(content, "utf8")).toBeLessThanOrEqual(200);
    expect(content).not.toContain("item 3");
    expect(content).not.toMatch(/�/);
  });

  it("builds documents the note validator accepts for every kind", () => {
    const outputs = {
      summary: "One.\n\nTwo.",
      checklist: "a\nb",
      table: "| x | y |\n| 1 | 2 |",
    } as const;
    for (const [kind, output] of Object.entries(outputs)) {
      const document = buildPileNoteDocument(
        kind as keyof typeof outputs,
        "Pile",
        output,
      );
      expect(() =>
        normalizeNoteContent({ formatVersion: 1, document }),
      ).not.toThrow();
    }
  });

  it("bounds table columns and pads short rows", () => {
    const rows = parsePipeTable("| a | b | c | d | e | f | g | h |\n| 1 | 2 |");
    expect(rows[0]).toHaveLength(6);
    expect(rows[1]).toEqual(["1", "2", "", "", "", ""]);
  });
});
