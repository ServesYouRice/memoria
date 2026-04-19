type JsonSchema = Record<string, unknown>;

export interface McpToolDefinition {
  name: string;
  description: string;
  inputSchema: JsonSchema;
}

export interface McpToolCallResult {
  content: Array<{ type: "text"; text: string }>;
  structuredContent?: unknown;
}

const MCP_PROTOCOL_VERSION = "2024-11-05";

function objectSchema(
  properties: Record<string, unknown>,
  required: string[] = [],
) {
  return {
    type: "object",
    properties,
    ...(required.length > 0 ? { required } : {}),
    additionalProperties: false,
  } satisfies JsonSchema;
}

export function listMcpTools(): McpToolDefinition[] {
  return [
    {
      name: "canvases.list",
      description: "List canvases visible to the current agent scope.",
      inputSchema: objectSchema({
        limit: { type: "integer", minimum: 1, maximum: 100, default: 50 },
        offset: { type: "integer", minimum: 0, default: 0 },
      }),
    },
    {
      name: "canvases.get",
      description: "Read one canvas and its metadata.",
      inputSchema: objectSchema(
        {
          canvasId: { type: "string" },
        },
        ["canvasId"],
      ),
    },
    {
      name: "items.list",
      description: "List raw canvas items for one canvas.",
      inputSchema: objectSchema(
        {
          canvasId: { type: "string" },
        },
        ["canvasId"],
      ),
    },
    {
      name: "items.create",
      description: "Create one raw canvas item.",
      inputSchema: objectSchema(
        {
          agentProfileId: { type: "string" },
          canvasId: { type: "string" },
          item: { type: "object" },
          summary: { type: "string" },
        },
        ["canvasId", "item"],
      ),
    },
    {
      name: "items.propose_create",
      description: "Create an internal proposal to add one raw canvas item.",
      inputSchema: objectSchema(
        {
          agentProfileId: { type: "string" },
          canvasId: { type: "string" },
          item: { type: "object" },
          summary: { type: "string" },
        },
        ["canvasId", "item"],
      ),
    },
    {
      name: "items.comment",
      description: "Add an audited comment to one canvas item.",
      inputSchema: objectSchema(
        {
          agentProfileId: { type: "string" },
          itemId: { type: "string" },
          content: { type: "string" },
          summary: { type: "string" },
        },
        ["itemId", "content"],
      ),
    },
    {
      name: "items.create_batch",
      description: "Create a grouped batch of raw canvas items on one canvas.",
      inputSchema: objectSchema(
        {
          agentProfileId: { type: "string" },
          canvasId: { type: "string" },
          items: { type: "array" },
          summary: { type: "string" },
        },
        ["canvasId", "items"],
      ),
    },
    {
      name: "items.preview_bulk_create",
      description:
        "Create a checkpoint and proposal for a bulk item creation run.",
      inputSchema: objectSchema(
        {
          agentProfileId: { type: "string" },
          canvasId: { type: "string" },
          items: { type: "array" },
          summary: { type: "string" },
          checkpointReason: { type: "string" },
        },
        ["canvasId", "items"],
      ),
    },
    {
      name: "knowledge.list",
      description:
        "List derived semantic entities for a canvas or source item.",
      inputSchema: objectSchema({
        canvasId: { type: "string" },
        itemId: { type: "string" },
      }),
    },
    {
      name: "knowledge.create",
      description: "Create one knowledge entity linked to a source item.",
      inputSchema: objectSchema(
        {
          agentProfileId: { type: "string" },
          itemId: { type: "string" },
          entityType: { type: "string" },
          title: { type: "string" },
          summary: { type: "string" },
          attributes: { type: "object" },
          sourceConfidence: { type: "number", minimum: 0, maximum: 1 },
        },
        ["itemId", "entityType", "title"],
      ),
    },
    {
      name: "knowledge.propose_create",
      description:
        "Create a proposal for one knowledge entity linked to a source item.",
      inputSchema: objectSchema(
        {
          agentProfileId: { type: "string" },
          itemId: { type: "string" },
          entityType: { type: "string" },
          title: { type: "string" },
          summary: { type: "string" },
          attributes: { type: "object" },
          sourceConfidence: { type: "number", minimum: 0, maximum: 1 },
        },
        ["itemId", "entityType", "title"],
      ),
    },
    {
      name: "actions.list",
      description: "List recent agent actions, change sets, and suggestions.",
      inputSchema: objectSchema({
        limit: { type: "integer", minimum: 1, maximum: 100, default: 50 },
      }),
    },
    {
      name: "actions.approve_suggestion",
      description: "Approve one open suggestion.",
      inputSchema: objectSchema(
        {
          suggestionId: { type: "string" },
        },
        ["suggestionId"],
      ),
    },
    {
      name: "actions.reject_suggestion",
      description: "Reject one open or approved suggestion.",
      inputSchema: objectSchema(
        {
          suggestionId: { type: "string" },
        },
        ["suggestionId"],
      ),
    },
    {
      name: "actions.execute_suggestion",
      description: "Execute one approved suggestion.",
      inputSchema: objectSchema(
        {
          agentProfileId: { type: "string" },
          suggestionId: { type: "string" },
        },
        ["suggestionId"],
      ),
    },
    {
      name: "actions.revert_change_set",
      description: "Revert one audited change set.",
      inputSchema: objectSchema(
        {
          agentProfileId: { type: "string" },
          changeSetId: { type: "string" },
        },
        ["changeSetId"],
      ),
    },
    {
      name: "actions.create_checkpoint",
      description: "Create one workspace checkpoint for a canvas.",
      inputSchema: objectSchema(
        {
          agentProfileId: { type: "string" },
          canvasId: { type: "string" },
          reason: { type: "string" },
        },
        ["canvasId", "reason"],
      ),
    },
    {
      name: "actions.propose_external",
      description: "Create a proposal for one outbound webhook action.",
      inputSchema: objectSchema(
        {
          agentProfileId: { type: "string" },
          summary: { type: "string" },
          payload: { type: "object" },
        },
        ["summary", "payload"],
      ),
    },
    {
      name: "integrations.list",
      description: "List integration accounts for the current user.",
      inputSchema: objectSchema({}),
    },
    {
      name: "providers.list",
      description: "List provider credential slots and configured credentials.",
      inputSchema: objectSchema({}),
    },
  ];
}

export function buildMcpInitializeResult() {
  return {
    protocolVersion: MCP_PROTOCOL_VERSION,
    capabilities: {
      tools: {},
    },
    serverInfo: {
      name: "memoria-agent-gateway",
      version: "0.1.0",
    },
  };
}
