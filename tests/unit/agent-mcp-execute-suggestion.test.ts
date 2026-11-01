import { beforeEach, describe, expect, it, vi } from "vitest";
import { AgentProfileStatus } from "@/generated/prisma/client";
import { assertCanvasScope } from "@/lib/agents/policy";
import { BadRequestError, ForbiddenError } from "@/lib/errors";

const mocks = vi.hoisted(() => ({
  suggestionFindFirst: vi.fn(),
  claimSuggestionForExecution: vi.fn(),
  markSuggestionExecuted: vi.fn(),
  createCanvasItemWrite: vi.fn(),
  createCanvasItemBatchWrite: vi.fn(),
  createKnowledgeEntityWrite: vi.fn(),
  createKnowledgeRelationWrite: vi.fn(),
  executeExternalWebhook: vi.fn(),
  requireScopedCanvas: vi.fn(),
  requireScopedItem: vi.fn(),
  requireScopedKnowledgeEntity: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  prisma: { suggestion: { findFirst: mocks.suggestionFindFirst } },
}));

vi.mock("@/lib/agents/service-core", () => ({
  claimSuggestionForExecution: mocks.claimSuggestionForExecution,
  markSuggestionExecuted: mocks.markSuggestionExecuted,
  createCanvasItemWrite: mocks.createCanvasItemWrite,
  createCanvasItemBatchWrite: mocks.createCanvasItemBatchWrite,
  createKnowledgeEntityWrite: mocks.createKnowledgeEntityWrite,
  createKnowledgeRelationWrite: mocks.createKnowledgeRelationWrite,
  executeExternalWebhook: mocks.executeExternalWebhook,
  normalizeAgentItemWriteData: (item: unknown) => item,
  normalizeAgentItemWriteBatch: (items: unknown) => items,
}));

vi.mock("@/lib/agents/query-core", () => ({
  requireScopedCanvas: mocks.requireScopedCanvas,
  requireScopedItem: mocks.requireScopedItem,
  requireScopedKnowledgeEntity: mocks.requireScopedKnowledgeEntity,
}));

import { executeMcpTool } from "@/lib/agents/mcp";

const canvasId = "ccanvas000000000000000001";
const otherCanvasId = "ccanvas000000000000000002";
const suggestionId = "csugg00000000000000000001";
const itemId = "citem000000000000000000001";

function profile(overrides?: {
  allowedCanvasIds?: string[];
  enabledRungs?: number[];
}) {
  return {
    id: "prof-propose",
    userId: "user-123",
    name: "Connected app",
    status: AgentProfileStatus.ACTIVE,
    maxCapabilityRung: 3,
    enabledRungs: [0, 1, 2, 3],
    allowedCanvasIds: [canvasId],
    defaultModelCredentialId: null,
    ...overrides,
  };
}

const payloads: Record<string, Record<string, unknown>> = {
  "canvas-item-create": {
    kind: "canvas-item-create",
    canvasId,
    item: { type: "NOTE", content: { text: "hi" } },
  },
  "canvas-item-batch-create": {
    kind: "canvas-item-batch-create",
    canvasId,
    items: [{ type: "NOTE", content: { text: "hi" } }],
  },
  "knowledge-entity-create": {
    kind: "knowledge-entity-create",
    itemId,
    entityType: "person",
    title: "Ada",
  },
  "knowledge-relation-create": {
    kind: "knowledge-relation-create",
    sourceEntityId: "cent0000000000000000000001",
    targetEntityId: "cent0000000000000000000002",
    relationType: "knows",
  },
};

const writeMocks: Record<string, ReturnType<typeof vi.fn>> = {
  "canvas-item-create": mocks.createCanvasItemWrite,
  "canvas-item-batch-create": mocks.createCanvasItemBatchWrite,
  "knowledge-entity-create": mocks.createKnowledgeEntityWrite,
  "knowledge-relation-create": mocks.createKnowledgeRelationWrite,
};

function arrange(payload: Record<string, unknown>, status = "APPROVED") {
  mocks.suggestionFindFirst.mockResolvedValue({
    id: suggestionId,
    agentProfileId: "prof-propose",
    status,
    summary: "Suggested change",
    payload,
    expiresAt: new Date(Date.now() + 60_000),
  });
  mocks.requireScopedCanvas.mockImplementation(
    async (ctx: { agentProfile: ReturnType<typeof profile> }, id: string) => {
      assertCanvasScope(ctx.agentProfile, id);
      return { id };
    },
  );
  mocks.requireScopedItem.mockResolvedValue({ id: itemId, canvasId });
  mocks.requireScopedKnowledgeEntity.mockImplementation(
    async (_ctx: unknown, id: string) => ({ id, canvasIds: [canvasId] }),
  );
  for (const mock of Object.values(writeMocks)) {
    mock.mockResolvedValue({ ok: true });
  }
}

function execute(agentProfile: ReturnType<typeof profile>) {
  return executeMcpTool(
    {
      actorType: "user",
      userId: "user-123",
      agentProfile,
      integrationAccountId: null,
    } as never,
    "actions.execute_suggestion",
    { suggestionId },
  );
}

describe("MCP execution of owner-approved suggestions (IMP-068)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it.each(Object.keys(payloads))(
    "executes an approved %s suggestion for a rung 0-3 profile",
    async (kind) => {
      arrange(payloads[kind]);

      await execute(profile());

      expect(writeMocks[kind]).toHaveBeenCalledTimes(1);
      expect(mocks.markSuggestionExecuted).toHaveBeenCalledTimes(1);
    },
  );

  it.each(Object.keys(payloads))(
    "refuses an unapproved %s suggestion",
    async (kind) => {
      arrange(payloads[kind], "PENDING");

      await expect(execute(profile())).rejects.toBeInstanceOf(BadRequestError);
      expect(writeMocks[kind]).not.toHaveBeenCalled();
    },
  );

  it.each(Object.keys(payloads))(
    "refuses a %s suggestion outside the profile's canvas scope",
    async (kind) => {
      arrange(payloads[kind]);

      await expect(
        execute(profile({ allowedCanvasIds: [otherCanvasId] })),
      ).rejects.toBeInstanceOf(ForbiddenError);
      expect(writeMocks[kind]).not.toHaveBeenCalled();
    },
  );

  it("refuses an approved suggestion when the propose rung is disabled", async () => {
    arrange(payloads["canvas-item-create"]);

    await expect(
      execute(profile({ enabledRungs: [0, 1, 2] })),
    ).rejects.toBeInstanceOf(ForbiddenError);
    expect(mocks.createCanvasItemWrite).not.toHaveBeenCalled();
  });

  it("still requires rung 8 to execute an approved external webhook", async () => {
    arrange({
      kind: "external-webhook",
      integrationAccountId: "cint0000000000000000000001",
      request: { method: "POST", body: {} },
    });

    await expect(execute(profile())).rejects.toMatchObject({
      status: 403,
      detail: expect.stringMatching(/capability rung/),
    });
    expect(mocks.executeExternalWebhook).not.toHaveBeenCalled();
  });
});
