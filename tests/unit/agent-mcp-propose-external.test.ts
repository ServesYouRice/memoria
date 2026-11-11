import { beforeEach, describe, expect, it, vi } from "vitest";
import { AgentProfileStatus } from "@/generated/prisma/client";

const mocks = vi.hoisted(() => ({
  integrationAccountFindFirst: vi.fn(),
  suggestionFindFirst: vi.fn(),
  createSuggestionRecord: vi.fn(),
  claimSuggestionForExecution: vi.fn(),
  createCanvasItemBatchWrite: vi.fn(),
  executeExternalWebhook: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    integrationAccount: { findFirst: mocks.integrationAccountFindFirst },
    suggestion: { findFirst: mocks.suggestionFindFirst },
  },
}));

vi.mock("@/lib/agents/service-core", () => ({
  createSuggestionRecord: mocks.createSuggestionRecord,
  claimSuggestionForExecution: mocks.claimSuggestionForExecution,
  createCanvasItemBatchWrite: mocks.createCanvasItemBatchWrite,
  executeExternalWebhook: mocks.executeExternalWebhook,
  markSuggestionExecuted: vi.fn(),
  normalizeAgentItemWriteData: (item: unknown) => item,
  normalizeAgentItemWriteBatch: (items: unknown) => items,
}));

vi.mock("@/lib/agents/query-core", () => ({
  requireScopedCanvas: vi.fn(async (_ctx: unknown, id: string) => ({ id })),
}));

import { executeMcpTool } from "@/lib/agents/mcp";

const canvasId = "ccanvas000000000000000001";
const integrationAccountId = "cint0000000000000000000001";
const agentProfile = {
  id: "prof-ext",
  userId: "user-123",
  name: "External",
  status: AgentProfileStatus.ACTIVE,
  maxCapabilityRung: 8,
  enabledRungs: [0, 1, 2, 3, 4, 5, 6, 7, 8],
  allowedCanvasIds: [canvasId],
  defaultModelCredentialId: null,
};
const context = {
  actorType: "integration",
  userId: "user-123",
  agentProfile,
  integrationAccountId: "int-1",
} as never;

const validPayload = {
  kind: "external-webhook",
  integrationAccountId,
  request: { method: "POST", body: { hello: "world" } },
};

function propose(args: Record<string, unknown>) {
  return executeMcpTool(context, "actions.propose_external", args);
}

describe("MCP actions.propose_external validation (TASK-024)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.integrationAccountFindFirst.mockResolvedValue({
      id: integrationAccountId,
      providerType: "WEBHOOK",
    });
    mocks.createSuggestionRecord.mockResolvedValue({ id: "s1" });
  });

  it.each([
    [
      "an internal payload kind",
      {
        summary: "ok",
        payload: { ...validPayload, kind: "canvas-item-batch-create" },
      },
    ],
    [
      "a non-cuid integration account",
      {
        summary: "ok",
        payload: { ...validPayload, integrationAccountId: "x" },
      },
    ],
    ["an empty summary", { summary: "", payload: validPayload }],
    [
      "a 256-character summary",
      { summary: "a".repeat(256), payload: validPayload },
    ],
  ])("rejects %s", async (_label, args) => {
    await expect(propose(args)).rejects.toBeTruthy();
    expect(mocks.createSuggestionRecord).not.toHaveBeenCalled();
  });

  it("stores a valid proposal as an EXTERNAL_ACTION suggestion", async () => {
    await propose({ summary: "Ping the CRM", payload: validPayload });
    expect(mocks.createSuggestionRecord).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: "EXTERNAL_ACTION",
        summary: "Ping the CRM",
        payload: expect.objectContaining({
          kind: "external-webhook",
          integrationAccountId,
          request: expect.objectContaining({ method: "POST", headers: {} }),
        }),
      }),
    );
  });
});

describe("MCP execute refuses kind/payload mismatches before claiming (TASK-024)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it.each([
    [
      "EXTERNAL_ACTION",
      {
        kind: "canvas-item-batch-create",
        canvasId,
        executionMode: "bulk",
        items: [{ type: "NOTE", content: { text: "hi" } }],
      },
    ],
    ["INTERNAL_ORGANIZATION", validPayload],
  ])(
    "refuses a %s suggestion with a mismatched payload",
    async (kind, payload) => {
      mocks.suggestionFindFirst.mockResolvedValue({
        id: "csugg00000000000000000001",
        agentProfileId: agentProfile.id,
        kind,
        status: "APPROVED",
        summary: "Mismatched",
        payload,
        expiresAt: new Date(Date.now() + 60_000),
      });
      await expect(
        executeMcpTool(context, "actions.execute_suggestion", {
          suggestionId: "csugg00000000000000000001",
        }),
      ).rejects.toMatchObject({ status: 400 });
      expect(mocks.claimSuggestionForExecution).not.toHaveBeenCalled();
      expect(mocks.createCanvasItemBatchWrite).not.toHaveBeenCalled();
      expect(mocks.executeExternalWebhook).not.toHaveBeenCalled();
    },
  );
});
