import { beforeEach, describe, expect, it, vi } from "vitest";
import { type NextRequest } from "next/server";
import { UnauthorizedError } from "@/lib/errors";
import { AgentProfileStatus } from "@/generated/prisma/client";

const authMocks = vi.hoisted(() => ({
  resolveAgentRequestContext: vi.fn(),
  getOwnedAgentProfile: vi.fn(),
}));

const queryCoreMocks = vi.hoisted(() => ({
  listOwnedProviderCredentials: vi.fn(),
  listOwnedIntegrationAccounts: vi.fn(),
  listAgentActions: vi.fn(),
  listAgentCanvases: vi.fn(),
  listAgentCanvasItems: vi.fn(),
  queryAgentKnowledge: vi.fn(),
  requireScopedKnowledgeEntity: vi.fn(),
}));

const serviceCoreMocks = vi.hoisted(() => ({
  createCanvasItemWrite: vi.fn(),
  createCanvasItemBatchWrite: vi.fn(),
  createKnowledgeEntityWrite: vi.fn(),
  createKnowledgeRelationWrite: vi.fn(),
  claimSuggestionForExecution: vi.fn(),
  markSuggestionExecuted: vi.fn(),
  releaseSuggestionClaim: vi.fn(),
  executeExternalWebhook: vi.fn(),
  executeAgentAction: vi.fn(),
  ingestAgentKnowledge: vi.fn(),
}));

const mcpMocks = vi.hoisted(() => ({
  buildMcpInitializeResult: vi.fn(() => ({
    protocolVersion: "2024-11-05",
    capabilities: {},
    serverInfo: { name: "memoria", version: "1.0.0" },
  })),
  listMcpTools: vi.fn(() => [
    { name: "read_canvas", description: "Read canvas" },
  ]),
  executeMcpTool: vi.fn(),
}));

const prismaMocks = vi.hoisted(() => ({
  canvasFindFirst: vi.fn(),
  suggestionFindFirst: vi.fn(),
  canvasItemFindFirst: vi.fn(),
  integrationAccountFindFirst: vi.fn(),
  modelCredentialCreate: vi.fn(),
  integrationAccountCreate: vi.fn(),
}));

vi.mock("@/lib/agents/auth", () => ({
  resolveAgentRequestContext: authMocks.resolveAgentRequestContext,
  getOwnedAgentProfile: authMocks.getOwnedAgentProfile,
  getBearerToken: (request: Request) =>
    request.headers.get("authorization")?.replace(/^Bearer\s+/, "") || null,
}));

vi.mock("@/lib/agents/query-core", () => ({
  listOwnedProviderCredentials: queryCoreMocks.listOwnedProviderCredentials,
  listOwnedIntegrationAccounts: queryCoreMocks.listOwnedIntegrationAccounts,
  listAgentActions: queryCoreMocks.listAgentActions,
  listAgentCanvases: queryCoreMocks.listAgentCanvases,
  listAgentCanvasItems: queryCoreMocks.listAgentCanvasItems,
  queryAgentKnowledge: queryCoreMocks.queryAgentKnowledge,
  requireScopedKnowledgeEntity: queryCoreMocks.requireScopedKnowledgeEntity,
}));

vi.mock("@/lib/agents/service-core", () => ({
  createCanvasItemWrite: serviceCoreMocks.createCanvasItemWrite,
  createCanvasItemBatchWrite: serviceCoreMocks.createCanvasItemBatchWrite,
  createKnowledgeEntityWrite: serviceCoreMocks.createKnowledgeEntityWrite,
  createKnowledgeRelationWrite: serviceCoreMocks.createKnowledgeRelationWrite,
  claimSuggestionForExecution: serviceCoreMocks.claimSuggestionForExecution,
  markSuggestionExecuted: serviceCoreMocks.markSuggestionExecuted,
  releaseSuggestionClaim: serviceCoreMocks.releaseSuggestionClaim,
  executeExternalWebhook: serviceCoreMocks.executeExternalWebhook,
  normalizeAgentItemWriteData: (item: unknown) => item,
  normalizeAgentItemWriteBatch: (items: unknown) => items,
  executeAgentAction: serviceCoreMocks.executeAgentAction,
  ingestAgentKnowledge: serviceCoreMocks.ingestAgentKnowledge,
}));

vi.mock("@/lib/agents/mcp", () => ({
  buildMcpInitializeResult: mcpMocks.buildMcpInitializeResult,
  listMcpTools: mcpMocks.listMcpTools,
  executeMcpTool: mcpMocks.executeMcpTool,
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    canvas: {
      findFirst: prismaMocks.canvasFindFirst,
    },
    suggestion: {
      findFirst: prismaMocks.suggestionFindFirst,
    },
    canvasItem: {
      findFirst: prismaMocks.canvasItemFindFirst,
    },
    modelCredential: {
      create: prismaMocks.modelCredentialCreate,
    },
    integrationAccount: {
      create: prismaMocks.integrationAccountCreate,
      findFirst: prismaMocks.integrationAccountFindFirst,
    },
  },
}));

import {
  GET as actionsGet,
  POST as actionsPost,
} from "@/app/api/agent/v1/actions/route";
import { GET as canvasesGet } from "@/app/api/agent/v1/canvases/route";
import {
  GET as itemsGet,
  POST as itemsPost,
} from "@/app/api/agent/v1/items/route";
import {
  GET as knowledgeGet,
  POST as knowledgePost,
} from "@/app/api/agent/v1/knowledge/route";
import {
  GET as providersGet,
  POST as providersPost,
} from "@/app/api/agent/v1/providers/route";
import {
  GET as integrationsGet,
  POST as integrationsPost,
} from "@/app/api/agent/v1/integrations/route";
import { POST as ingestPost } from "@/app/api/agent/v1/integrations/ingest/route";
import { GET as mcpGet, POST as mcpPost } from "@/app/api/agent/v1/mcp/route";

function createNextRequest(
  url: string,
  options?: {
    method?: string;
    headers?: Record<string, string>;
    body?: unknown;
  },
): NextRequest {
  const init: RequestInit = {
    method: options?.method || "GET",
    headers: {
      "Content-Type": "application/json",
      ...(options?.headers || {}),
    },
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

describe("Agent Route Authentication Boundaries (IMP-059)", () => {
  const mockUserContext = {
    actorType: "user" as const,
    userId: "user-123",
    agentProfile: null,
    integrationAccountId: null,
  };

  const mockIntegrationContext = {
    actorType: "integration" as const,
    userId: "user-123",
    agentProfile: {
      id: "prof-1",
      userId: "user-123",
      name: "Bot",
      status: AgentProfileStatus.ACTIVE,
      maxCapabilityRung: 3,
      enabledRungs: [1, 2, 3],
      allowedCanvasIds: ["c-inbox-1"],
      defaultModelCredentialId: null,
    },
    integrationAccountId: "int-1",
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("Protected method exports rejection on unauthenticated request", () => {
    beforeEach(() => {
      authMocks.resolveAgentRequestContext.mockRejectedValue(
        new UnauthorizedError("Authentication required"),
      );
    });

    const routeTable = [
      {
        name: "actions GET",
        handler: () =>
          actionsGet(
            createNextRequest("http://localhost/api/agent/v1/actions"),
          ),
      },
      {
        name: "actions POST",
        handler: () =>
          actionsPost(
            createNextRequest("http://localhost/api/agent/v1/actions", {
              method: "POST",
              body: {
                action: "approve-suggestion",
                suggestionId: "cjld2cjxh0000qzrmn831i7rn",
              },
            }),
          ),
      },
      {
        name: "canvases GET",
        handler: () =>
          canvasesGet(
            createNextRequest("http://localhost/api/agent/v1/canvases"),
          ),
      },
      {
        name: "items GET",
        handler: () =>
          itemsGet(
            createNextRequest(
              "http://localhost/api/agent/v1/items?canvasId=cjld2cjxh0000qzrmn831i7rn",
            ),
          ),
      },
      {
        name: "items POST",
        handler: () =>
          itemsPost(
            createNextRequest("http://localhost/api/agent/v1/items", {
              method: "POST",
              body: {
                canvasId: "cjld2cjxh0000qzrmn831i7rn",
                type: "note",
                content: { text: "hello" },
                positionX: 100,
                positionY: 100,
              },
            }),
          ),
      },
      {
        name: "knowledge GET",
        handler: () =>
          knowledgeGet(
            createNextRequest(
              "http://localhost/api/agent/v1/knowledge?query=test",
            ),
          ),
      },
      {
        name: "knowledge POST",
        handler: () =>
          knowledgePost(
            createNextRequest("http://localhost/api/agent/v1/knowledge", {
              method: "POST",
              body: { content: "Sample knowledge snippet" },
            }),
          ),
      },
      {
        name: "providers GET",
        handler: () =>
          providersGet(
            createNextRequest("http://localhost/api/agent/v1/providers"),
          ),
      },
      {
        name: "providers POST",
        handler: () =>
          providersPost(
            createNextRequest("http://localhost/api/agent/v1/providers", {
              method: "POST",
              body: {
                provider: "OPENAI",
                label: "My Key",
                defaultModel: "gpt-4o",
                secret: "sk-proj-test",
              },
            }),
          ),
      },
      {
        name: "integrations GET",
        handler: () =>
          integrationsGet(
            createNextRequest("http://localhost/api/agent/v1/integrations"),
          ),
      },
      {
        name: "integrations POST",
        handler: () =>
          integrationsPost(
            createNextRequest("http://localhost/api/agent/v1/integrations", {
              method: "POST",
              body: {
                agentProfileId: "cjld2cjxh0000qzrmn831i7rn",
                providerType: "SLACK",
                externalAccountId: "U12345",
              },
            }),
          ),
      },
      {
        name: "integrations/ingest POST",
        handler: () =>
          ingestPost(
            createNextRequest(
              "http://localhost/api/agent/v1/integrations/ingest",
              {
                method: "POST",
                body: { type: "note", content: "Ingest content" },
              },
            ),
          ),
      },
    ];

    it.each(routeTable)(
      "rejects $name with 401 and executes zero downstream operations",
      async ({ handler }) => {
        const res = await handler();
        expect(res.status).toBe(401);

        // Ensure zero downstream service/query operations were executed
        expect(
          queryCoreMocks.listOwnedProviderCredentials,
        ).not.toHaveBeenCalled();
        expect(
          queryCoreMocks.listOwnedIntegrationAccounts,
        ).not.toHaveBeenCalled();
        expect(queryCoreMocks.listAgentActions).not.toHaveBeenCalled();
        expect(queryCoreMocks.listAgentCanvases).not.toHaveBeenCalled();
        expect(queryCoreMocks.listAgentCanvasItems).not.toHaveBeenCalled();
        expect(queryCoreMocks.queryAgentKnowledge).not.toHaveBeenCalled();
        expect(serviceCoreMocks.createCanvasItemWrite).not.toHaveBeenCalled();
        expect(serviceCoreMocks.executeAgentAction).not.toHaveBeenCalled();
        expect(serviceCoreMocks.ingestAgentKnowledge).not.toHaveBeenCalled();
        expect(prismaMocks.modelCredentialCreate).not.toHaveBeenCalled();
        expect(prismaMocks.integrationAccountCreate).not.toHaveBeenCalled();
      },
    );
  });

  describe("Credential-mode branching and actor validation", () => {
    it("rejects integration actors from providers management routes before database work", async () => {
      authMocks.resolveAgentRequestContext.mockResolvedValue(
        mockIntegrationContext,
      );

      const getRes = await providersGet(
        createNextRequest("http://localhost/api/agent/v1/providers"),
      );
      expect(getRes.status).toBe(403);
      expect(
        queryCoreMocks.listOwnedProviderCredentials,
      ).not.toHaveBeenCalled();

      const postRes = await providersPost(
        createNextRequest("http://localhost/api/agent/v1/providers", {
          method: "POST",
          body: {
            provider: "OPENAI",
            label: "OpenAI Key",
            defaultModel: "gpt-4o",
            secret: "sk-proj-mock",
          },
        }),
      );
      expect(postRes.status).toBe(403);
      expect(prismaMocks.modelCredentialCreate).not.toHaveBeenCalled();
    });

    it("rejects integration actors from integrations management routes before database work", async () => {
      authMocks.resolveAgentRequestContext.mockResolvedValue(
        mockIntegrationContext,
      );

      const getRes = await integrationsGet(
        createNextRequest("http://localhost/api/agent/v1/integrations"),
      );
      expect(getRes.status).toBe(403);
      expect(
        queryCoreMocks.listOwnedIntegrationAccounts,
      ).not.toHaveBeenCalled();

      const postRes = await integrationsPost(
        createNextRequest("http://localhost/api/agent/v1/integrations", {
          method: "POST",
          body: {
            agentProfileId: "cjld2cjxh0000qzrmn831i7rn",
            providerType: "SLACK",
            externalAccountId: "U12345",
          },
        }),
      );
      expect(postRes.status).toBe(403);
      expect(authMocks.getOwnedAgentProfile).not.toHaveBeenCalled();
    });

    it("ingest route enforces allowUserSession: false and requireAgentProfile: true", async () => {
      authMocks.resolveAgentRequestContext.mockResolvedValue(
        mockIntegrationContext,
      );
      prismaMocks.canvasFindFirst.mockResolvedValue({
        id: "c-inbox-1",
        name: "Inbox",
        userId: "user-123",
      });
      serviceCoreMocks.createCanvasItemWrite.mockResolvedValue({
        id: "item-1",
        type: "note",
      });

      const req = createNextRequest(
        "http://localhost/api/agent/v1/integrations/ingest",
        {
          method: "POST",
          body: { type: "note", content: "Ingested note content" },
        },
      );

      const res = await ingestPost(req);
      expect(res.status).toBe(201);

      expect(authMocks.resolveAgentRequestContext).toHaveBeenCalledWith(req, {
        allowUserSession: false,
        requireAgentProfile: true,
      });
      expect(serviceCoreMocks.createCanvasItemWrite).toHaveBeenCalledWith(
        expect.objectContaining({
          actor: {
            userId: "user-123",
            agentProfileId: "prof-1",
            integrationAccountId: "int-1",
            modelCredentialId: null,
          },
          canvasId: "c-inbox-1",
        }),
      );
    });

    it("providers GET succeeds for user context", async () => {
      authMocks.resolveAgentRequestContext.mockResolvedValue(mockUserContext);
      queryCoreMocks.listOwnedProviderCredentials.mockResolvedValue([
        { id: "cred-1", provider: "OPENAI" },
      ]);

      const res = await providersGet(
        createNextRequest("http://localhost/api/agent/v1/providers"),
      );
      expect(res.status).toBe(200);
      expect(queryCoreMocks.listOwnedProviderCredentials).toHaveBeenCalledWith(
        "user-123",
      );
    });
  });

  describe("Owner-approved suggestion execution (IMP-068)", () => {
    const canvasId = "ccanvas000000000000000001";
    const otherCanvasId = "ccanvas000000000000000002";
    const suggestionId = "csugg00000000000000000001";
    const itemId = "citem000000000000000000001";
    const entityA = "cent0000000000000000000001";
    const entityB = "cent0000000000000000000002";
    const proposeOnlyProfile = {
      id: "prof-propose",
      userId: "user-123",
      name: "Connected app",
      status: AgentProfileStatus.ACTIVE,
      maxCapabilityRung: 3,
      enabledRungs: [0, 1, 2, 3],
      allowedCanvasIds: [canvasId],
      defaultModelCredentialId: null,
    };

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
        sourceEntityId: entityA,
        targetEntityId: entityB,
        relationType: "knows",
      },
    };

    const writeMocks: Record<string, ReturnType<typeof vi.fn>> = {
      "canvas-item-create": serviceCoreMocks.createCanvasItemWrite,
      "canvas-item-batch-create": serviceCoreMocks.createCanvasItemBatchWrite,
      "knowledge-entity-create": serviceCoreMocks.createKnowledgeEntityWrite,
      "knowledge-relation-create":
        serviceCoreMocks.createKnowledgeRelationWrite,
    };

    function arrange(
      payload: Record<string, unknown>,
      overrides?: { status?: string; profile?: typeof proposeOnlyProfile },
    ) {
      authMocks.resolveAgentRequestContext.mockResolvedValue(mockUserContext);
      authMocks.getOwnedAgentProfile.mockResolvedValue(
        overrides?.profile ?? proposeOnlyProfile,
      );
      prismaMocks.suggestionFindFirst.mockResolvedValue({
        id: suggestionId,
        agentProfileId: proposeOnlyProfile.id,
        kind:
          payload.kind === "external-webhook"
            ? "EXTERNAL_ACTION"
            : "INTERNAL_ORGANIZATION",
        status: overrides?.status ?? "APPROVED",
        summary: "Suggested change",
        payload,
        expiresAt: new Date(Date.now() + 60_000),
      });
      prismaMocks.canvasFindFirst.mockResolvedValue({ id: canvasId });
      prismaMocks.canvasItemFindFirst.mockResolvedValue({
        id: itemId,
        canvasId,
      });
      queryCoreMocks.requireScopedKnowledgeEntity.mockImplementation(
        async (_ctx: unknown, id: string) => ({ id, canvasIds: [canvasId] }),
      );
      for (const mock of Object.values(writeMocks)) {
        mock.mockResolvedValue({ ok: true });
      }
    }

    function execute() {
      return actionsPost(
        createNextRequest("http://localhost/api/agent/v1/actions", {
          method: "POST",
          body: { action: "execute-suggestion", suggestionId },
        }),
      );
    }

    it.each(Object.keys(payloads))(
      "executes an approved %s suggestion for a rung 0-3 profile",
      async (kind) => {
        arrange(payloads[kind]);

        const res = await execute();

        expect(res.status).toBe(200);
        expect(writeMocks[kind]).toHaveBeenCalledTimes(1);
        expect(serviceCoreMocks.markSuggestionExecuted).toHaveBeenCalledTimes(
          1,
        );
      },
    );

    it.each(Object.keys(payloads))(
      "refuses an unapproved %s suggestion",
      async (kind) => {
        arrange(payloads[kind], { status: "PENDING" });

        const res = await execute();

        expect(res.status).toBe(400);
        expect(writeMocks[kind]).not.toHaveBeenCalled();
      },
    );

    it.each(Object.keys(payloads))(
      "refuses a %s suggestion outside the profile's canvas scope",
      async (kind) => {
        arrange(payloads[kind], {
          profile: { ...proposeOnlyProfile, allowedCanvasIds: [otherCanvasId] },
        });

        const res = await execute();

        expect(res.status).toBe(403);
        expect(writeMocks[kind]).not.toHaveBeenCalled();
      },
    );

    it("refuses an approved suggestion when the propose rung is disabled", async () => {
      arrange(payloads["canvas-item-create"], {
        profile: { ...proposeOnlyProfile, enabledRungs: [0, 1, 2] },
      });

      const res = await execute();

      expect(res.status).toBe(403);
      expect(serviceCoreMocks.createCanvasItemWrite).not.toHaveBeenCalled();
    });

    it.each([
      [
        "an out-of-scope canvas",
        () =>
          arrange(payloads["canvas-item-create"], {
            profile: {
              ...proposeOnlyProfile,
              allowedCanvasIds: [otherCanvasId],
            },
          }),
        403,
      ],
      [
        "a disabled propose rung",
        () =>
          arrange(payloads["canvas-item-create"], {
            profile: { ...proposeOnlyProfile, enabledRungs: [0, 1, 2] },
          }),
        403,
      ],
      [
        "an unsupported payload kind",
        () => arrange({ kind: "not-a-kind" }),
        400,
      ],
      [
        "an invalid payload",
        () =>
          arrange({ kind: "canvas-item-batch-create", canvasId, items: [] }),
        400,
      ],
    ])(
      "refuses %s before claiming the suggestion",
      async (_case, setup, status) => {
        setup();

        const res = await execute();

        expect(res.status).toBe(status);
        expect(
          serviceCoreMocks.claimSuggestionForExecution,
        ).not.toHaveBeenCalled();
      },
    );

    it("releases the claim when the internal write fails, so a retry runs", async () => {
      arrange(payloads["canvas-item-create"]);
      serviceCoreMocks.createCanvasItemWrite.mockRejectedValueOnce(
        new Error("Canvas is full"),
      );

      const failed = await execute();

      expect(failed.status).toBe(500);
      expect(serviceCoreMocks.releaseSuggestionClaim).toHaveBeenCalledWith({
        userId: "user-123",
        suggestionId,
      });
      expect(serviceCoreMocks.markSuggestionExecuted).not.toHaveBeenCalled();

      const retried = await execute();

      expect(retried.status).toBe(200);
      expect(
        serviceCoreMocks.claimSuggestionForExecution,
      ).toHaveBeenCalledTimes(2);
      expect(serviceCoreMocks.markSuggestionExecuted).toHaveBeenCalledTimes(1);
    });

    it("still requires rung 8 to execute an approved external webhook", async () => {
      arrange({
        kind: "external-webhook",
        integrationAccountId: "cint0000000000000000000001",
        request: { method: "POST", body: {} },
      });
      prismaMocks.integrationAccountFindFirst.mockResolvedValue({
        id: "cint0000000000000000000001",
        agentProfileId: proposeOnlyProfile.id,
        providerType: "WEBHOOK",
        status: "ACTIVE",
      });

      const res = await execute();

      expect(res.status).toBe(403);
      expect(serviceCoreMocks.executeExternalWebhook).not.toHaveBeenCalled();
    });

    it.each([
      ["another agent profile", "prof-other"],
      ["no agent profile", null],
    ])(
      "refuses a token executing a suggestion of %s before claiming it",
      async (_label, ownerProfileId) => {
        arrange(payloads["canvas-item-create"]);
        authMocks.resolveAgentRequestContext.mockResolvedValue({
          actorType: "integration",
          userId: "user-123",
          agentProfile: proposeOnlyProfile,
          integrationAccountId: "int-1",
        });
        prismaMocks.suggestionFindFirst.mockResolvedValue({
          id: suggestionId,
          agentProfileId: ownerProfileId,
          kind: "WRITE",
          status: "APPROVED",
          summary: "Suggested change",
          payload: payloads["canvas-item-create"],
          expiresAt: new Date(Date.now() + 60_000),
        });

        const res = await execute();

        expect(res.status).toBe(403);
        expect(
          serviceCoreMocks.claimSuggestionForExecution,
        ).not.toHaveBeenCalled();
        expect(serviceCoreMocks.createCanvasItemWrite).not.toHaveBeenCalled();
      },
    );

    it.each([
      ["EXTERNAL_ACTION", payloads["canvas-item-batch-create"]],
      [
        "INTERNAL_ORGANIZATION",
        {
          kind: "external-webhook",
          integrationAccountId: "cint0000000000000000000001",
          request: { method: "POST", body: {} },
        },
      ],
    ])(
      "refuses a %s suggestion whose payload kind disagrees, before claiming",
      async (kind, payload) => {
        arrange(payload);
        prismaMocks.suggestionFindFirst.mockResolvedValue({
          id: suggestionId,
          agentProfileId: proposeOnlyProfile.id,
          kind,
          status: "APPROVED",
          summary: "Mismatched",
          payload,
          expiresAt: new Date(Date.now() + 60_000),
        });

        const res = await execute();

        expect(res.status).toBe(400);
        expect(
          serviceCoreMocks.claimSuggestionForExecution,
        ).not.toHaveBeenCalled();
        expect(
          serviceCoreMocks.createCanvasItemBatchWrite,
        ).not.toHaveBeenCalled();
      },
    );

    it("lets a token execute its own profile's approved suggestion", async () => {
      arrange(payloads["canvas-item-create"]);
      authMocks.resolveAgentRequestContext.mockResolvedValue({
        actorType: "integration",
        userId: "user-123",
        agentProfile: proposeOnlyProfile,
        integrationAccountId: "int-1",
      });

      const res = await execute();

      expect(res.status).toBe(200);
      expect(serviceCoreMocks.claimSuggestionForExecution).toHaveBeenCalled();
    });
  });

  describe("MCP authorization boundaries", () => {
    const resourceMetadata =
      'resource_metadata="http://localhost:3000/.well-known/oauth-protected-resource/api/agent/v1/mcp"';

    it.each([
      ["initialize", { jsonrpc: "2.0", id: 1, method: "initialize" }],
      ["tools/list", { jsonrpc: "2.0", id: 3, method: "tools/list" }],
      [
        "notifications/initialized",
        { jsonrpc: "2.0", method: "notifications/initialized" },
      ],
    ])(
      "answers an unauthenticated %s with HTTP 401 that points at OAuth discovery",
      async (_method, body) => {
        authMocks.resolveAgentRequestContext.mockRejectedValue(
          new UnauthorizedError("Authentication required"),
        );

        const res = await mcpPost(
          createNextRequest("http://localhost/api/agent/v1/mcp", {
            method: "POST",
            body,
          }),
        );

        expect(res.status).toBe(401);
        expect(res.headers.get("WWW-Authenticate")).toBe(
          `Bearer ${resourceMetadata}`,
        );
        expect(mcpMocks.buildMcpInitializeResult).not.toHaveBeenCalled();
        expect(mcpMocks.listMcpTools).not.toHaveBeenCalled();
      },
    );

    it("marks a rejected bearer token as invalid_token", async () => {
      authMocks.resolveAgentRequestContext.mockRejectedValue(
        new UnauthorizedError("Invalid or expired access token."),
      );

      const res = await mcpPost(
        createNextRequest("http://localhost/api/agent/v1/mcp", {
          method: "POST",
          headers: { Authorization: "Bearer moa_expired" },
          body: { jsonrpc: "2.0", id: 9, method: "initialize" },
        }),
      );

      expect(res.status).toBe(401);
      expect(res.headers.get("WWW-Authenticate")).toBe(
        `Bearer ${resourceMetadata}, error="invalid_token"`,
      );
      const json = await res.json();
      expect(json.error.code).toBe(-32001);
    });

    it("negotiates initialize once the caller is authenticated", async () => {
      authMocks.resolveAgentRequestContext.mockResolvedValue(
        mockIntegrationContext,
      );

      const res = await mcpPost(
        createNextRequest("http://localhost/api/agent/v1/mcp", {
          method: "POST",
          body: {
            jsonrpc: "2.0",
            id: 1,
            method: "initialize",
            params: { protocolVersion: "2025-06-18" },
          },
        }),
      );

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.result.serverInfo.name).toBe("memoria");
      expect(mcpMocks.buildMcpInitializeResult).toHaveBeenCalledWith(
        "2025-06-18",
      );
    });

    it("acknowledges notifications with 202 for authenticated callers", async () => {
      authMocks.resolveAgentRequestContext.mockResolvedValue(mockUserContext);

      const res = await mcpPost(
        createNextRequest("http://localhost/api/agent/v1/mcp", {
          method: "POST",
          body: { jsonrpc: "2.0", method: "notifications/initialized" },
        }),
      );

      expect(res.status).toBe(202);
    });

    it("handles ping and tools/list for authenticated callers", async () => {
      authMocks.resolveAgentRequestContext.mockResolvedValue(mockUserContext);

      const ping = await mcpPost(
        createNextRequest("http://localhost/api/agent/v1/mcp", {
          method: "POST",
          body: { jsonrpc: "2.0", id: 2, method: "ping" },
        }),
      );
      expect((await ping.json()).result).toEqual({ ok: true });

      const list = await mcpPost(
        createNextRequest("http://localhost/api/agent/v1/mcp", {
          method: "POST",
          body: { jsonrpc: "2.0", id: 3, method: "tools/list" },
        }),
      );
      expect((await list.json()).result.tools).toHaveLength(1);
    });

    it("tools/call returns HTTP 401 on auth failure without executing tool", async () => {
      authMocks.resolveAgentRequestContext.mockRejectedValue(
        new UnauthorizedError("Actor authentication required"),
      );

      const res = await mcpPost(
        createNextRequest("http://localhost/api/agent/v1/mcp", {
          method: "POST",
          body: {
            jsonrpc: "2.0",
            id: 4,
            method: "tools/call",
            params: { name: "read_canvas", arguments: { canvasId: "c-1" } },
          },
        }),
      );

      expect(res.status).toBe(401);
      const json = await res.json();
      expect(json.error.code).toBe(-32001);
      expect(mcpMocks.executeMcpTool).not.toHaveBeenCalled();
    });

    it("rejects malformed JSON with a JSON-RPC parse error", async () => {
      const res = await mcpPost(
        createNextRequest("http://localhost/api/agent/v1/mcp", {
          method: "POST",
          body: "{not json",
        }),
      );

      expect(res.status).toBe(400);
      expect((await res.json()).error.code).toBe(-32700);
      expect(authMocks.resolveAgentRequestContext).not.toHaveBeenCalled();
    });

    it("declines server-sent streams on GET", async () => {
      const res = mcpGet();
      expect(res.status).toBe(405);
      expect(res.headers.get("Allow")).toBe("POST");
    });

    it("tools/call executes tool when actor context is successfully resolved", async () => {
      authMocks.resolveAgentRequestContext.mockResolvedValue(mockUserContext);
      mcpMocks.executeMcpTool.mockResolvedValue({
        content: [{ type: "text", text: "canvas details" }],
      });

      const res = await mcpPost(
        createNextRequest("http://localhost/api/agent/v1/mcp", {
          method: "POST",
          body: {
            jsonrpc: "2.0",
            id: 5,
            method: "tools/call",
            params: { name: "read_canvas", arguments: { canvasId: "c-1" } },
          },
        }),
      );

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.result.content[0].text).toBe("canvas details");
      expect(mcpMocks.executeMcpTool).toHaveBeenCalledWith(
        mockUserContext,
        "read_canvas",
        { canvasId: "c-1" },
      );
    });
  });
});
