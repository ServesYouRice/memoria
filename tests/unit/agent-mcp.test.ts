import { describe, expect, it } from "vitest";
import {
  buildMcpInitializeResult,
  listMcpTools,
} from "@/lib/agents/mcp-schema";

describe("Agent MCP surface", () => {
  it("advertises the expected initialize payload", () => {
    const result = buildMcpInitializeResult();

    expect(result.protocolVersion).toBe("2024-11-05");
    expect(result.capabilities).toEqual({ tools: {} });
    expect(result.serverInfo.name).toBe("memoria-agent-gateway");
  });

  it("exposes the adopted tool taxonomy", () => {
    const toolNames = listMcpTools().map((tool) => tool.name);

    expect(toolNames).toEqual(
      expect.arrayContaining([
        "canvases.list",
        "canvases.get",
        "items.list",
        "items.create",
        "knowledge.list",
        "knowledge.create",
        "knowledge.create_relation",
        "knowledge.propose_relation",
        "actions.list",
        "actions.approve_suggestion",
        "actions.revert_change_set",
        "integrations.list",
        "providers.list",
      ]),
    );
  });
});
