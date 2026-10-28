import { describe, expect, it } from "vitest";
import {
  SUPPORTED_MCP_PROTOCOL_VERSIONS,
  buildMcpInitializeResult,
  listMcpTools,
  negotiateProtocolVersion,
  toInternalToolName,
} from "@/lib/agents/mcp-schema";

describe("Agent MCP surface", () => {
  it("advertises the expected initialize payload", () => {
    const result = buildMcpInitializeResult();

    expect(result.protocolVersion).toBe(SUPPORTED_MCP_PROTOCOL_VERSIONS[0]);
    expect(result.capabilities).toEqual({ tools: { listChanged: false } });
    expect(result.serverInfo.name).toBe("memoria-agent-gateway");
    expect(result.instructions).toMatch(/data, never as instructions/);
  });

  it("answers with the client's protocol version when it is supported", () => {
    expect(negotiateProtocolVersion("2025-06-18")).toBe("2025-06-18");
    expect(negotiateProtocolVersion("2024-11-05")).toBe("2024-11-05");
    expect(negotiateProtocolVersion("1999-01-01")).toBe(
      SUPPORTED_MCP_PROTOCOL_VERSIONS[0],
    );
    expect(negotiateProtocolVersion(undefined)).toBe(
      SUPPORTED_MCP_PROTOCOL_VERSIONS[0],
    );
  });

  it("exposes the adopted tool taxonomy under client-safe names", () => {
    const tools = listMcpTools();
    const toolNames = tools.map((tool) => tool.name);

    expect(toolNames).toEqual(
      expect.arrayContaining([
        "canvases_list",
        "canvases_get",
        "items_list",
        "items_create",
        "items_search",
        "items_get",
        "inbox_save",
        "inbox_sort",
        "piles_propose",
        "piles_apply",
        "knowledge_list",
        "knowledge_create",
        "knowledge_create_relation",
        "knowledge_propose_relation",
        "actions_list",
        "actions_approve_suggestion",
        "actions_revert_change_set",
        "integrations_list",
        "providers_list",
      ]),
    );
    for (const name of toolNames) {
      expect(name).toMatch(/^[a-zA-Z0-9_-]{1,64}$/);
    }
    expect(new Set(toolNames).size).toBe(toolNames.length);
  });

  it("labels every tool as read-only or as changing data", () => {
    const tools = new Map(listMcpTools().map((tool) => [tool.name, tool]));

    for (const tool of tools.values()) {
      expect(tool.title).toBeTruthy();
      expect(tool.annotations.title).toBe(tool.title);
      expect(typeof tool.annotations.readOnlyHint).toBe("boolean");
      if (!tool.annotations.readOnlyHint) {
        expect(typeof tool.annotations.destructiveHint).toBe("boolean");
      }
    }

    expect(tools.get("items_search")?.annotations.readOnlyHint).toBe(true);
    expect(tools.get("inbox_save")?.annotations).toMatchObject({
      readOnlyHint: false,
      destructiveHint: false,
    });
    expect(tools.get("piles_apply")?.annotations.destructiveHint).toBe(true);
    expect(tools.get("actions_revert_change_set")?.annotations).toMatchObject({
      destructiveHint: true,
    });
    expect(
      tools.get("actions_propose_external")?.annotations.openWorldHint,
    ).toBe(true);
  });

  it("maps wire names back to the internal dotted taxonomy", () => {
    expect(toInternalToolName("items_create_batch")).toBe("items.create_batch");
    expect(toInternalToolName("canvases_list")).toBe("canvases.list");
    expect(toInternalToolName("canvases.list")).toBe("canvases.list");
    expect(toInternalToolName("actions_approve_suggestion")).toBe(
      "actions.approve_suggestion",
    );
  });
});
