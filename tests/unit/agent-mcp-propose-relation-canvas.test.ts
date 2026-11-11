/**
 * TASK-139 — an MCP knowledge-relation proposal stores the shared canvas, so
 * the organizer can place it in that canvas's queue.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AgentProfileStatus } from "@/generated/prisma/client";

const mocks = vi.hoisted(() => ({
  createSuggestionRecord: vi.fn(),
  requireScopedKnowledgeEntity: vi.fn(),
}));

vi.mock("@/lib/db", () => ({ prisma: {} }));
vi.mock("@/lib/agents/service-core", () => ({
  createSuggestionRecord: mocks.createSuggestionRecord,
}));
vi.mock("@/lib/agents/query-core", () => ({
  requireScopedKnowledgeEntity: mocks.requireScopedKnowledgeEntity,
}));

import { executeMcpTool } from "@/lib/agents/mcp";

const sourceEntityId = "ckz7q0xqf0000l908f3h4d6r6";
const targetEntityId = "ckz7q0xqf0001l908f3h4d6r7";
const context = {
  actorType: "integration",
  userId: "user-1",
  integrationAccountId: "int-1",
  agentProfile: {
    id: "prof-1",
    userId: "user-1",
    name: "Agent",
    status: AgentProfileStatus.ACTIVE,
    maxCapabilityRung: 4,
    enabledRungs: [0, 1, 2, 3, 4],
    allowedCanvasIds: ["canvas-1"],
    defaultModelCredentialId: null,
  },
} as never;

describe("MCP knowledge.propose_relation (TASK-139)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireScopedKnowledgeEntity.mockImplementation(
      async (_ctx: unknown, id: string) => ({
        id,
        title: id,
        canvasIds:
          id === sourceEntityId ? ["canvas-9", "canvas-1"] : ["canvas-1"],
      }),
    );
    mocks.createSuggestionRecord.mockResolvedValue({ id: "s1" });
  });

  it("stores the shared canvas on the proposal payload", async () => {
    await executeMcpTool(context, "knowledge.propose_relation", {
      sourceEntityId,
      targetEntityId,
      relationType: "depends_on",
    });

    expect(mocks.createSuggestionRecord).toHaveBeenCalledWith(
      expect.objectContaining({
        payload: expect.objectContaining({
          kind: "knowledge-relation-create",
          canvasId: "canvas-1",
        }),
      }),
    );
  });
});
