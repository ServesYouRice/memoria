import { type NextRequest, NextResponse } from "next/server";
import { ApiError, BadRequestError } from "@/lib/errors";
import { withApiHandler } from "@/lib/api/route-handler";
import { resolveAgentRequestContext } from "@/lib/agents/auth";
import type { McpToolCallResult } from "@/lib/agents/mcp-schema";
import {
  buildMcpInitializeResult,
  executeMcpTool,
  listMcpTools,
} from "@/lib/agents/mcp";

interface JsonRpcRequest {
  id?: string | number | null;
  method?: string;
  params?: Record<string, unknown>;
}

function createJsonRpcSuccess(id: JsonRpcRequest["id"], result: unknown) {
  return NextResponse.json({
    jsonrpc: "2.0",
    id: id ?? null,
    result,
  });
}

function mapJsonRpcErrorCode(error: unknown) {
  if (error instanceof ApiError) {
    switch (error.status) {
      case 400:
      case 409:
      case 422:
        return -32602;
      case 401:
        return -32001;
      case 403:
        return -32003;
      case 404:
        return -32004;
      case 429:
        return -32029;
      default:
        return -32000;
    }
  }

  return -32000;
}

function createJsonRpcError(id: JsonRpcRequest["id"], error: unknown) {
  const message =
    error instanceof ApiError
      ? error.detail || error.title
      : error instanceof Error
        ? error.message
        : "Unknown MCP error.";

  return NextResponse.json({
    jsonrpc: "2.0",
    id: id ?? null,
    error: {
      code: mapJsonRpcErrorCode(error),
      message,
      data:
        error instanceof ApiError
          ? {
              status: error.status,
              title: error.title,
              type: error.type,
            }
          : undefined,
    },
  });
}

async function handleMcpRequest(request: NextRequest, body: JsonRpcRequest) {
  const method = typeof body.method === "string" ? body.method : null;
  if (!method) {
    throw new BadRequestError("MCP method is required.");
  }

  const id = body.id ?? null;
  const params =
    body.params &&
    typeof body.params === "object" &&
    !Array.isArray(body.params)
      ? body.params
      : {};

  switch (method) {
    case "initialize":
      return createJsonRpcSuccess(id, buildMcpInitializeResult());
    case "notifications/initialized":
      return new NextResponse(null, { status: 202 });
    case "ping":
      return createJsonRpcSuccess(id, { ok: true });
    case "tools/list":
      return createJsonRpcSuccess(id, { tools: listMcpTools() });
    case "tools/call": {
      const toolName = typeof params.name === "string" ? params.name : "";
      if (!toolName) {
        throw new BadRequestError("params.name is required for tools/call.");
      }

      const context = await resolveAgentRequestContext(request);
      const result = await executeMcpTool(
        context,
        toolName,
        Object.prototype.hasOwnProperty.call(params, "arguments")
          ? params.arguments
          : {},
      );

      return createJsonRpcSuccess(id, result satisfies McpToolCallResult);
    }
    default:
      throw new BadRequestError(`Unsupported MCP method: ${method}`);
  }
}

export const POST = withApiHandler(async (request: NextRequest) => {
  const body = (await request.json()) as JsonRpcRequest;

  try {
    return await handleMcpRequest(request, body);
  } catch (error) {
    return createJsonRpcError(body?.id ?? null, error);
  }
});
