import { describe, expect, it, vi } from "vitest";
import { type NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  resolveAgentRequestContext: vi.fn(),
  createKnowledgeEntityWrite: vi.fn(),
  createSuggestionRecord: vi.fn(),
  requireScopedItem: vi.fn(),
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
  requireScopedKnowledgeEntity: vi.fn(),
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
