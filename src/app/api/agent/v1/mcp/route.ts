import { type NextRequest, NextResponse } from "next/server";
import { ApiError, BadRequestError, UnauthorizedError } from "@/lib/errors";
import { withApiHandler } from "@/lib/api/route-handler";
import { getBearerToken, resolveAgentRequestContext } from "@/lib/agents/auth";
import type { McpToolCallResult } from "@/lib/agents/mcp-schema";
import {
  buildMcpInitializeResult,
  executeMcpTool,
  listMcpTools,
} from "@/lib/agents/mcp";
import { getProtectedResourceMetadataUrl } from "@/lib/oauth/config";

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

/**
 * MCP authorization (RFC 9728): an HTTP 401 that points at the protected
 * resource metadata is what makes clients start the OAuth sign-in.
 */
function createUnauthorizedResponse(
  id: JsonRpcRequest["id"],
  error: unknown,
  tokenPresented: boolean,
) {
  const challenge = [
    `Bearer resource_metadata="${getProtectedResourceMetadataUrl()}"`,
    ...(tokenPresented ? ['error="invalid_token"'] : []),
  ].join(", ");
  const response = createJsonRpcError(id, error);

  return new NextResponse(response.body, {
    status: 401,
    headers: {
      "Content-Type": "application/json",
      "WWW-Authenticate": challenge,
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

  // Every MCP request is authenticated, including initialize, so clients
  // learn up front that this server needs sign-in.
  const context = await resolveAgentRequestContext(request);

  if (body.id === undefined && method.startsWith("notifications/")) {
    return new NextResponse(null, { status: 202 });
  }

  switch (method) {
    case "initialize":
      return createJsonRpcSuccess(
        id,
        buildMcpInitializeResult(params.protocolVersion),
      );
    case "ping":
      return createJsonRpcSuccess(id, { ok: true });
    case "tools/list":
      return createJsonRpcSuccess(id, { tools: listMcpTools() });
    case "tools/call": {
      const toolName = typeof params.name === "string" ? params.name : "";
      if (!toolName) {
        throw new BadRequestError("params.name is required for tools/call.");
      }

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
  let body: JsonRpcRequest;
  try {
    body = (await request.json()) as JsonRpcRequest;
  } catch {
    return NextResponse.json(
      {
        jsonrpc: "2.0",
        id: null,
        error: { code: -32700, message: "Parse error." },
      },
      { status: 400 },
    );
  }

  try {
    return await handleMcpRequest(request, body);
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      return createUnauthorizedResponse(
        body?.id ?? null,
        error,
        Boolean(getBearerToken(request)),
      );
    }
    return createJsonRpcError(body?.id ?? null, error);
  }
});

/** This server answers each POST directly and offers no server-sent stream. */
export function GET() {
  return new NextResponse(null, { status: 405, headers: { Allow: "POST" } });
}
