import { describe, expect, it, vi } from "vitest";
import {
  AUTOPILOT_MAX_ITEMS,
  AutopilotTooLargeError,
  prepareAutopilot,
} from "@/lib/ai/autopilot-service";

function item(id: string, x: number, y: number, minute: number) {
  return {
    id,
    version: 1,
    positionX: x,
    positionY: y,
    createdAt: new Date(Date.UTC(2026, 0, 1, 0, minute)).toISOString(),
  };
}

function page(body: unknown) {
  return new Response(JSON.stringify(body), { status: 200 });
}

describe("prepareAutopilot", () => {
  it("lays out every canvas item, including ones outside the viewport", async () => {
    // b sits at the origin far from the viewport; a and c are the only
    // items a viewport-bound board would hold.
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        page({
          items: [item("a", 5000, 5000, 1), item("b", 0, 0, 0)],
          total: 3,
          hasMore: true,
          nextCursor: "cursor-1",
        }),
      )
      .mockResolvedValueOnce(
        page({ items: [item("c", 5400, 5000, 2)], total: 3, hasMore: false }),
      );

    const { items, actions } = await prepareAutopilot(
      "canvas-1",
      fetchMock as unknown as typeof fetch,
    );

    expect(items.map((i) => i.id)).toEqual(["a", "b", "c"]);
    expect(String(fetchMock.mock.calls[0]![0])).not.toMatch(/minX|maxX/);
    expect(String(fetchMock.mock.calls[1]![0])).toContain("cursor=cursor-1");
    // b keeps the origin slot instead of being covered by a.
    const targets = Object.fromEntries(
      actions.map((a) => [a.itemId, a.newPosition]),
    );
    expect(targets.b).toBeUndefined();
    expect(targets.a).toEqual({ x: 350, y: 0 });
    expect(targets.c).toEqual({ x: 700, y: 0 });
  });

  it("refuses a canvas larger than one batch write", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      page({
        items: [item("a", 0, 0, 0)],
        total: AUTOPILOT_MAX_ITEMS + 1,
        hasMore: true,
        nextCursor: "x",
      }),
    );
    await expect(
      prepareAutopilot("canvas-1", fetchMock as unknown as typeof fetch),
    ).rejects.toBeInstanceOf(AutopilotTooLargeError);
  });
});
