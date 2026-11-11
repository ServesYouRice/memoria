import { beforeEach, describe, expect, it, vi } from "vitest";
import { AgentProfileStatus } from "@/generated/prisma/client";
import { ForbiddenError } from "@/lib/errors";

const reads = vi.hoisted(() => ({
  searchScopedItems: vi.fn(async () => ({ items: [] })),
  getScopedItemDetail: vi.fn(async () => ({ item: { id: "i1" } })),
  listScopedCanvases: vi.fn(async () => ({ canvases: [] })),
  requireScopedCanvas: vi.fn(async () => ({ id: "c1" })),
  listScopedCanvasItems: vi.fn(async () => []),
  listScopedKnowledgeEntities: vi.fn(async () => ({ entities: [] })),
  listScopedActionTimeline: vi.fn(async () => ({ actions: [] })),
  listAgentBoards: vi.fn(async () => ({ boards: [] })),
  commentFindMany: vi.fn(async () => []),
}));

vi.mock("@/lib/db", () => ({
  prisma: { comment: { findMany: reads.commentFindMany } },
}));
vi.mock("@/lib/agents/query-core", () => ({
  searchScopedItems: reads.searchScopedItems,
  getScopedItemDetail: reads.getScopedItemDetail,
  listScopedCanvases: reads.listScopedCanvases,
  requireScopedCanvas: reads.requireScopedCanvas,
  listScopedCanvasItems: reads.listScopedCanvasItems,
  listScopedKnowledgeEntities: reads.listScopedKnowledgeEntities,
  listScopedActionTimeline: reads.listScopedActionTimeline,
}));
vi.mock("@/lib/agents/boards", () => ({
  listAgentBoards: reads.listAgentBoards,
  createAgentBoard: vi.fn(),
}));

import { executeMcpTool } from "@/lib/agents/mcp";

const READ_TOOLS: Array<[string, Record<string, unknown>]> = [
  ["items.search", { query: "knife" }],
  ["items.get", { itemId: "i1" }],
  ["items.list", { canvasId: "c1" }],
  ["canvases.list", {}],
  ["canvases.get", { canvasId: "c1" }],
  ["boards.list", {}],
  ["knowledge.list", {}],
  ["actions.list", {}],
];

function context(enabledRungs: number[] | null) {
  return {
    actorType: "integration",
    userId: "user-1",
    integrationAccountId: "int-1",
    agentProfile: enabledRungs
      ? {
          id: "prof-1",
          userId: "user-1",
          name: "Agent",
          status: AgentProfileStatus.ACTIVE,
          maxCapabilityRung: 3,
          enabledRungs,
          allowedCanvasIds: ["c1"],
          defaultModelCredentialId: null,
        }
      : null,
  } as never;
}

describe("MCP read tools require the READ rung (TASK-121)", () => {
  beforeEach(() => vi.clearAllMocks());

  it.each(READ_TOOLS)(
    "%s refuses a profile with READ disabled before reading",
    async (tool, args) => {
      await expect(
        executeMcpTool(context([1, 2, 3]), tool, args),
      ).rejects.toBeInstanceOf(ForbiddenError);
      for (const read of Object.values(reads)) {
        expect(read).not.toHaveBeenCalled();
      }
    },
  );

  it.each(READ_TOOLS)(
    "%s still reads with READ enabled",
    async (tool, args) => {
      await expect(
        executeMcpTool(context([0, 1, 2, 3]), tool, args),
      ).resolves.toBeTruthy();
    },
  );

  it.each(READ_TOOLS)(
    "%s still reads for a user session",
    async (tool, args) => {
      await expect(
        executeMcpTool(context(null), tool, args),
      ).resolves.toBeTruthy();
    },
  );
});
