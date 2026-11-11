import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  agentActionFindMany: vi.fn(),
  changeSetFindMany: vi.fn(),
  suggestionFindMany: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    agentAction: { findMany: mocks.agentActionFindMany },
    changeSet: { findMany: mocks.changeSetFindMany },
    suggestion: { findMany: mocks.suggestionFindMany },
  },
}));

import { listScopedActionTimeline } from "@/lib/agents/query-core";

describe("listScopedActionTimeline", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.agentActionFindMany.mockResolvedValue([]);
    mocks.suggestionFindMany.mockResolvedValue([]);
    mocks.changeSetFindMany.mockResolvedValue([
      {
        id: "cs-1",
        changeRecords: [{ id: "r-1", operation: "CREATE" }],
        _count: { changeRecords: 250 },
      },
    ]);
  });

  it("loads change-record metadata and counts, not the item snapshots", async () => {
    const result = await listScopedActionTimeline(
      { userId: "user-1", agentProfile: null },
      { limit: 100 },
    );

    const args = mocks.changeSetFindMany.mock.calls[0]![0];
    expect(args.include.changeRecords).not.toBe(true);
    expect(args.include.changeRecords.select).toBeDefined();
    expect(args.include.changeRecords.select.before).toBeUndefined();
    expect(args.include.changeRecords.select.after).toBeUndefined();
    expect(args.include._count).toEqual({ select: { changeRecords: true } });
    expect(args.take).toBe(100);
    expect(result.changeSets[0]).toMatchObject({
      id: "cs-1",
      changeRecordCount: 250,
    });
    expect(result.changeSets[0]).not.toHaveProperty("_count");
  });
});
