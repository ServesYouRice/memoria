import { beforeEach, describe, expect, it, vi } from "vitest";
import { type NextRequest } from "next/server";
import { AgentProfileStatus } from "@/generated/prisma/client";
import type * as ServiceCore from "@/lib/agents/service-core";

const mocks = vi.hoisted(() => ({
  resolveAgentRequestContext: vi.fn(),
  getOwnedAgentProfile: vi.fn(),
  revertChangeSet: vi.fn(),
  changeSetFindFirst: vi.fn(),
  canvasItemFindMany: vi.fn(),
}));

vi.mock("@/lib/agents/auth", () => ({
  resolveAgentRequestContext: mocks.resolveAgentRequestContext,
  getOwnedAgentProfile: mocks.getOwnedAgentProfile,
  getBearerToken: () => null,
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    changeSet: { findFirst: mocks.changeSetFindFirst },
    canvasItem: { findMany: mocks.canvasItemFindMany },
  },
}));

vi.mock("@/lib/agents/service-core", async (importOriginal) => ({
  ...(await importOriginal<typeof ServiceCore>()),
  revertChangeSet: mocks.revertChangeSet,
}));

import { POST } from "@/app/api/agent/v1/actions/route";

const changeSetId = "cjld2cjxh0000qzrmn831i7rn";

function revertRequest(): NextRequest {
  const url = "http://localhost/api/agent/v1/actions";
  const req = new Request(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "revert-change-set", changeSetId }),
  });
  (req as unknown as { nextUrl: URL }).nextUrl = new URL(url);
  return req as unknown as NextRequest;
}

const agentProfile = {
  id: "prof-agent",
  userId: "user-1",
  name: "Bot",
  status: AgentProfileStatus.ACTIVE,
  maxCapabilityRung: 4,
  enabledRungs: [1, 2, 3, 4],
  allowedCanvasIds: ["canvas-a"],
  defaultModelCredentialId: null,
};

const agentContext = {
  actorType: "integration" as const,
  userId: "user-1",
  agentProfile,
  integrationAccountId: "int-1",
};

function changeSet(overrides: Record<string, unknown> = {}) {
  return {
    id: changeSetId,
    agentProfileId: agentProfile.id,
    scopeType: "canvas",
    scopeId: "canvas-a",
    changeRecords: [{ targetType: "CanvasItem", targetId: "item-1" }],
    ...overrides,
  };
}

describe("POST /api/agent/v1/actions revert-change-set authorization", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.revertChangeSet.mockResolvedValue({ ok: true });
    mocks.canvasItemFindMany.mockResolvedValue([]);
  });

  it("refuses a scoped agent reverting a change set on a canvas outside its allowlist", async () => {
    mocks.resolveAgentRequestContext.mockResolvedValue(agentContext);
    mocks.changeSetFindFirst.mockResolvedValue(
      changeSet({ scopeId: "canvas-b" }),
    );

    const response = await POST(revertRequest());

    expect(response.status).toBe(403);
    expect(mocks.revertChangeSet).not.toHaveBeenCalled();
  });

  it("refuses an agent reverting a change set made by another agent profile", async () => {
    mocks.resolveAgentRequestContext.mockResolvedValue(agentContext);
    mocks.changeSetFindFirst.mockResolvedValue(
      changeSet({ agentProfileId: "prof-assistant" }),
    );

    const response = await POST(revertRequest());

    expect(response.status).toBe(403);
    expect(mocks.revertChangeSet).not.toHaveBeenCalled();
  });

  it("refuses a user-scoped change set touching an item on a forbidden canvas", async () => {
    mocks.resolveAgentRequestContext.mockResolvedValue(agentContext);
    mocks.changeSetFindFirst.mockResolvedValue(
      changeSet({ scopeType: "user", scopeId: "user-1" }),
    );
    mocks.canvasItemFindMany.mockResolvedValue([
      { id: "item-1", canvasId: "canvas-b" },
    ]);

    const response = await POST(revertRequest());

    expect(response.status).toBe(403);
    expect(mocks.revertChangeSet).not.toHaveBeenCalled();
  });

  it("lets an agent revert its own change set on an allowed canvas", async () => {
    mocks.resolveAgentRequestContext.mockResolvedValue(agentContext);
    mocks.changeSetFindFirst.mockResolvedValue(changeSet());

    const response = await POST(revertRequest());

    expect(response.status).toBe(200);
    expect(mocks.revertChangeSet).toHaveBeenCalledWith(
      expect.objectContaining({ changeSetId }),
    );
  });

  it("keeps the signed-in owner's undo for any agent profile and canvas", async () => {
    mocks.resolveAgentRequestContext.mockResolvedValue({
      actorType: "user",
      userId: "user-1",
      agentProfile: null,
      integrationAccountId: null,
    });
    mocks.changeSetFindFirst.mockResolvedValue({
      id: changeSetId,
      agentProfileId: "prof-assistant",
    });
    mocks.getOwnedAgentProfile.mockResolvedValue({
      ...agentProfile,
      id: "prof-assistant",
      allowedCanvasIds: [],
    });

    const response = await POST(revertRequest());

    expect(response.status).toBe(200);
    expect(mocks.revertChangeSet).toHaveBeenCalled();
  });
});
