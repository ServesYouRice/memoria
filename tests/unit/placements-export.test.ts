/**
 * IMP-109: a file export of a canvas holds the items shown on it from other
 * canvases, where they sit here, and an item is never written twice.
 */
import { describe, expect, it, vi } from "vitest";

const apiFetch = vi.hoisted(() => vi.fn());
vi.mock("@/lib/api/fetch-client", () => ({ apiFetch }));

import { fetchAllCanvasItems } from "@/lib/export/export-utils";
import {
  isPlaceableType,
  isPlacementChangedMessage,
} from "@/lib/placements/shared";

const json = (body: unknown) => new Response(JSON.stringify(body));

function placed(id: string) {
  return {
    placementId: `p-${id}`,
    homeCanvasId: "home",
    homeCanvasName: "Home",
    item: {
      id,
      type: "NOTE",
      content: { text: `shown ${id}` },
      tags: [],
      version: 3,
      positionX: 400,
      positionY: 50,
      width: 200,
      height: 100,
      zIndex: 9,
      createdAt: "2026-11-14T00:00:00.000Z",
      updatedAt: "2026-11-14T00:00:00.000Z",
    },
  };
}

describe("exporting a canvas with shown items (IMP-109)", () => {
  it("adds them with this canvas's geometry, once", async () => {
    apiFetch.mockImplementation(async (url: string) =>
      url.includes("/placements")
        ? json({ placements: [placed("shown"), placed("own")] })
        : json({
            items: [{ id: "own", canvasId: "here", type: "NOTE" }],
            hasMore: false,
            nextCursor: null,
          }),
    );
    const items = await fetchAllCanvasItems("here");
    expect(items.map((item) => item.id)).toEqual(["own", "shown"]);
    expect(items[1]).toMatchObject({
      canvasId: "here",
      positionX: 400,
      content: { text: "shown shown" },
    });
  });
});

describe("placement helpers (IMP-109)", () => {
  it("keeps arrows, frames and polls on their own canvas", () => {
    expect(isPlaceableType("NOTE")).toBe(true);
    expect(isPlaceableType("TABLE")).toBe(true);
    for (const type of ["ARROW", "FRAME", "POLL"])
      expect(isPlaceableType(type)).toBe(false);
  });

  it("recognises the live notice", () => {
    expect(
      isPlacementChangedMessage({ type: "placement-changed", itemId: "a" }),
    ).toBe(true);
    expect(
      isPlacementChangedMessage({ type: "poll-changed", itemId: "a" }),
    ).toBe(false);
  });
});
