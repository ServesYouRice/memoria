// @vitest-environment happy-dom

import React from "react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import {
  canvasItemMatchesSearch,
  canvasItemSearchText,
  isStructuralCanvasItem,
} from "@/features/canvas/search";
import { CanvasItemListView } from "@/features/canvas/components/CanvasItemListView";
import {
  ItemType,
  resolveCanvasCapabilities,
  type CanvasItem,
} from "@/types/canvas";

function item(overrides: Partial<CanvasItem> & { id: string }): CanvasItem {
  return {
    canvasId: "canvas-1",
    type: ItemType.NOTE,
    positionX: 0,
    positionY: 0,
    width: 100,
    height: 100,
    zIndex: 0,
    content: { text: "" },
    tags: [],
    version: 1,
    deletedAt: null,
    createdById: "user-1",
    updatedById: null,
    deletedById: null,
    createdAt: new Date(0),
    updatedAt: new Date(0),
    ...overrides,
  };
}

afterEach(cleanup);

describe("in-canvas text search", () => {
  const note = item({
    id: "note-1",
    content: { text: "<p>Quarterly roadmap</p>" },
  });
  const connection = item({
    id: "arrow-1",
    type: ItemType.ARROW,
    content: { startItemId: "note-1", endItemId: "bookmark-1" },
  });

  it("searches authored content and tags without arbitrary JSON serialization", () => {
    const bookmark = item({
      id: "bookmark-1",
      type: ItemType.BOOKMARK,
      tags: ["research"],
      content: {
        url: "https://example.com",
        title: "Primary source",
        description: "Evidence",
      },
    });
    expect(canvasItemMatchesSearch(note, "roadmap")).toBe(true);
    expect(canvasItemMatchesSearch(bookmark, "research")).toBe(true);
    expect(canvasItemSearchText(bookmark)).toContain("primary source");
    expect(canvasItemMatchesSearch(connection, "roadmap")).toBe(false);
  });

  it("identifies relationship items as structural context", () => {
    expect(isStructuralCanvasItem(connection)).toBe(true);
    expect(isStructuralCanvasItem(note)).toBe(false);
  });

  it("keeps non-matching rows mounted and labels them as context", () => {
    render(
      <CanvasItemListView
        items={[note, connection]}
        capabilities={resolveCanvasCapabilities("VIEW")}
        searchQuery="roadmap"
        searchMatchIds={new Set([note.id])}
      />,
    );

    expect(screen.getByText(/1 search match/i)).toBeTruthy();
    expect(screen.getByText(/all 2 items remain listed/i)).toBeTruthy();
    expect(screen.getAllByText("search match")).toHaveLength(1);
    expect(screen.getAllByText("context")).toHaveLength(1);
    expect(screen.getByLabelText(/arrow:/i)).toBeTruthy();
  });
});
