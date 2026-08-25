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
}));

const serviceCoreMocks = vi.hoisted(() => ({
  createCanvasItemWrite: vi.fn(),
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
  modelCredentialCreate: vi.fn(),
  integrationAccountCreate: vi.fn(),
}));

vi.mock("@/lib/agents/auth", () => ({
  resolveAgentRequestContext: authMocks.resolveAgentRequestContext,
  getOwnedAgentProfile: authMocks.getOwnedAgentProfile,
}));

vi.mock("@/lib/agents/query-core", () => ({
  listOwnedProviderCredentials: queryCoreMocks.listOwnedProviderCredentials,
  listOwnedIntegrationAccounts: queryCoreMocks.listOwnedIntegrationAccounts,
  listAgentActions: queryCoreMocks.listAgentActions,
  listAgentCanvases: queryCoreMocks.listAgentCanvases,
  listAgentCanvasItems: queryCoreMocks.listAgentCanvasItems,
  queryAgentKnowledge: queryCoreMocks.queryAgentKnowledge,
}));

vi.mock("@/lib/agents/service-core", () => ({
  createCanvasItemWrite: serviceCoreMocks.createCanvasItemWrite,
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
    modelCredential: {
      create: prismaMocks.modelCredentialCreate,
    },
    integrationAccount: {
      create: prismaMocks.integrationAccountCreate,
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
import { POST as mcpPost } from "@/app/api/agent/v1/mcp/route";

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

  describe("MCP public vs protected protocol boundaries", () => {
    it("handles initialize without resolving actor context", async () => {
      const res = await mcpPost(
        createNextRequest("http://localhost/api/agent/v1/mcp", {
          method: "POST",
          body: { jsonrpc: "2.0", id: 1, method: "initialize" },
        }),
      );

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.result.serverInfo.name).toBe("memoria");
      expect(authMocks.resolveAgentRequestContext).not.toHaveBeenCalled();
    });

    it("handles notifications/initialized with 202 without resolving actor context", async () => {
      const res = await mcpPost(
        createNextRequest("http://localhost/api/agent/v1/mcp", {
          method: "POST",
          body: { jsonrpc: "2.0", method: "notifications/initialized" },
        }),
      );

      expect(res.status).toBe(202);
      expect(authMocks.resolveAgentRequestContext).not.toHaveBeenCalled();
    });

    it("handles ping without resolving actor context", async () => {
      const res = await mcpPost(
        createNextRequest("http://localhost/api/agent/v1/mcp", {
          method: "POST",
          body: { jsonrpc: "2.0", id: 2, method: "ping" },
        }),
      );

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.result).toEqual({ ok: true });
      expect(authMocks.resolveAgentRequestContext).not.toHaveBeenCalled();
    });

    it("handles tools/list without resolving actor context", async () => {
      const res = await mcpPost(
        createNextRequest("http://localhost/api/agent/v1/mcp", {
          method: "POST",
          body: { jsonrpc: "2.0", id: 3, method: "tools/list" },
        }),
      );

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.result.tools).toHaveLength(1);
      expect(authMocks.resolveAgentRequestContext).not.toHaveBeenCalled();
    });

    it("tools/call returns JSON-RPC -32001 unauthorized error on auth failure without executing tool", async () => {
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

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.error).toBeDefined();
      expect(json.error.code).toBe(-32001);
      expect(mcpMocks.executeMcpTool).not.toHaveBeenCalled();
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
