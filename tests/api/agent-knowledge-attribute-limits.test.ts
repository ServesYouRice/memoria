import { describe, expect, it, vi } from "vitest";
import { type NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  resolveAgentRequestContext: vi.fn(),
  createKnowledgeEntityWrite: vi.fn(),
  createSuggestionRecord: vi.fn(),
  requireScopedItem: vi.fn(),
  requireScopedKnowledgeEntity: vi.fn(),
}));

vi.mock("@/lib/agents/auth", () => ({
  resolveAgentRequestContext: mocks.resolveAgentRequestContext,
}));
vi.mock("@/lib/agents/service-core", () => ({
  createKnowledgeEntityWrite: mocks.createKnowledgeEntityWrite,
  createKnowledgeRelationWrite: vi.fn(),
  createSuggestionRecord: mocks.createSuggestionRecord,
}));
vi.mock("@/lib/agents/query-core", () => ({
  listScopedKnowledgeEntities: vi.fn(),
  requireScopedKnowledgeEntity: mocks.requireScopedKnowledgeEntity,
  requireScopedItem: mocks.requireScopedItem,
}));

import { POST } from "@/app/api/agent/v1/knowledge/route";

function post(body: unknown): NextRequest {
  const url = "http://localhost/api/agent/v1/knowledge";
  const req = new Request(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  (req as unknown as { nextUrl: URL }).nextUrl = new URL(url);
  return req as unknown as NextRequest;
}

const agentContext = {
  actorType: "integration",
  userId: "user-1",
  integrationAccountId: "int-1",
  agentProfile: {
    id: "prof-1",
    status: "ACTIVE",
    maxCapabilityRung: 4,
    enabledRungs: [1, 2, 3, 4],
    allowedCanvasIds: ["canvas-1"],
    defaultModelCredentialId: null,
  },
};

describe("POST /api/agent/v1/knowledge relation proposals", () => {
  it("stores the shared canvas on the proposal so the organizer can show it", async () => {
    mocks.resolveAgentRequestContext.mockResolvedValue(agentContext);
    mocks.requireScopedKnowledgeEntity.mockImplementation(
      async (_ctx: unknown, id: string) => ({
        id,
        title: id,
        canvasIds:
          id === "ckz7q0xqf0000l908f3h4d6r6"
            ? ["canvas-1", "canvas-9"]
            : ["canvas-1"],
      }),
    );
    mocks.createSuggestionRecord.mockResolvedValue({ suggestion: { id: "s" } });

    const response = await POST(
      post({
        kind: "relation",
        sourceEntityId: "ckz7q0xqf0000l908f3h4d6r6",
        targetEntityId: "ckz7q0xqf0001l908f3h4d6r7",
        relationType: "depends_on",
      }),
    );

    expect(response.status).toBe(201);
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

describe("POST /api/agent/v1/knowledge attribute limits", () => {
  it("returns 400 for oversized attributes before any write", async () => {
    mocks.resolveAgentRequestContext.mockResolvedValue({
      actorType: "integration",
      userId: "user-1",
      integrationAccountId: "int-1",
      agentProfile: {
        id: "prof-1",
        status: "ACTIVE",
        maxCapabilityRung: 4,
        enabledRungs: [1, 2, 3, 4],
        allowedCanvasIds: ["canvas-1"],
        defaultModelCredentialId: null,
      },
    });

    const response = await POST(
      post({
        itemId: "ckz7q0xqf0000l908f3h4d6r6",
        entityType: "topic",
        title: "Roadmap",
        attributes: { blob: "x".repeat(100_000) },
      }),
    );

    expect(response.status).toBe(400);
    expect(mocks.requireScopedItem).not.toHaveBeenCalled();
    expect(mocks.createSuggestionRecord).not.toHaveBeenCalled();
    expect(mocks.createKnowledgeEntityWrite).not.toHaveBeenCalled();
  });
});
