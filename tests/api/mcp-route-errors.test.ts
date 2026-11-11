/**
 * TASK-176 — the MCP endpoint does not echo internal error messages, logs and
 * reports server failures, rejects non-object bodies as Invalid Request, and
 * maps argument validation errors to Invalid params.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { z } from "zod";
import type * as LoggerModule from "@/lib/logger";

const mocks = vi.hoisted(() => ({
  resolveAgentRequestContext: vi.fn(),
  executeMcpTool: vi.fn(),
  captureException: vi.fn(),
  logError: vi.fn(),
}));

vi.mock("@sentry/nextjs", () => ({
  captureException: mocks.captureException,
  withScope: (run: (scope: { setTag: () => void }) => void) =>
    run({ setTag: () => undefined }),
}));
vi.mock("@/lib/logger", async (importOriginal) => {
  const actual = (await importOriginal()) as typeof LoggerModule;
  return {
    ...actual,
    logger: new Proxy(actual.logger, {
      get(target, prop, receiver) {
        if (prop === "error") return mocks.logError;
        return Reflect.get(target, prop, receiver);
      },
    }),
  };
});
vi.mock("@/lib/agents/auth", () => ({
  resolveAgentRequestContext: mocks.resolveAgentRequestContext,
  getBearerToken: (request: Request) =>
    request.headers.get("authorization")?.replace(/^Bearer\s+/, "") || null,
}));
vi.mock("@/lib/agents/mcp", () => ({
  buildMcpInitializeResult: vi.fn(() => ({})),
  listMcpTools: vi.fn(() => []),
  executeMcpTool: mocks.executeMcpTool,
}));

import { POST } from "@/app/api/agent/v1/mcp/route";
import { UnauthorizedError } from "@/lib/errors";

function rpc(body: string) {
  return POST(
    new NextRequest("http://localhost:3000/api/agent/v1/mcp", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: "Bearer mem_test",
      },
      body,
    }),
    { params: Promise.resolve({}) } as never,
  );
}

function toolCall() {
  return rpc(
    JSON.stringify({
      jsonrpc: "2.0",
      id: 7,
      method: "tools/call",
      params: { name: "read_canvas", arguments: {} },
    }),
  );
}

describe("MCP route errors", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.resolveAgentRequestContext.mockResolvedValue({
      actorType: "agent",
      userId: "user-1",
    });
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("hides an internal error message in production and logs and reports it", async () => {
    vi.stubEnv("NODE_ENV", "production");
    const failure = new Error("secret internal detail");
    mocks.executeMcpTool.mockRejectedValue(failure);
    const response = await toolCall();
    const body = await response.json();
    expect(body.id).toBe(7);
    expect(body.error.code).toBe(-32000);
    expect(body.error.message).toBe("An unexpected error occurred.");
    expect(JSON.stringify(body)).not.toContain("secret internal detail");
    expect(mocks.captureException).toHaveBeenCalledWith(failure);
    expect(mocks.logError).toHaveBeenCalled();
  });

  it("returns Invalid Request for a null body without TypeError text", async () => {
    const response = await rpc("null");
    const body = await response.json();
    expect(body).toMatchObject({ id: null, error: { code: -32600 } });
    expect(JSON.stringify(body)).not.toMatch(/Cannot read|TypeError/);
  });

  it("returns Invalid Request for an array body", async () => {
    const body = await (await rpc("[]")).json();
    expect(body.error.code).toBe(-32600);
  });

  it("maps a ZodError from tool arguments to Invalid params", async () => {
    const parsed = z.object({ canvasId: z.string() }).safeParse({});
    mocks.executeMcpTool.mockRejectedValue(parsed.error);
    const body = await (await toolCall()).json();
    expect(body.error.code).toBe(-32602);
    expect(body.error.message).toContain("canvasId");
    expect(mocks.captureException).not.toHaveBeenCalled();
  });

  it("keeps the 401 challenge for unauthorized requests", async () => {
    mocks.resolveAgentRequestContext.mockRejectedValue(
      new UnauthorizedError("Token rejected"),
    );
    const response = await toolCall();
    expect(response.status).toBe(401);
    expect(response.headers.get("www-authenticate")).toContain("Bearer");
    expect(mocks.captureException).not.toHaveBeenCalled();
  });
});
