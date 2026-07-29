/**
 * IMP-022 / DEC-009 — accessible and responsive canvas.
 *
 * The acceptance criterion is that core canvas content is discoverable and
 * operable without pointer or canvas pixels. These tests drive the DOM item
 * list the way a keyboard or screen-reader user would.
 */

import React from "react";
import {
  render,
  screen,
  cleanup,
  within,
  fireEvent,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  CanvasItemListView,
  describeItemDetail,
  describeItemHeading,
} from "@/features/canvas/components/CanvasItemListView";
import { CanvasAccessiblePanel } from "@/features/canvas/components/CanvasAccessiblePanel";
import {
  ItemType,
  NO_CANVAS_CAPABILITIES,
  resolveCanvasCapabilities,
  type CanvasItem,
} from "@/types/canvas";

const EDITOR = resolveCanvasCapabilities("EDIT");
const VIEWER = resolveCanvasCapabilities("VIEW");

function makeItem(overrides: Partial<CanvasItem> & { id: string }): CanvasItem {
  return {
    canvasId: "canvas-1",
    type: ItemType.NOTE,
    positionX: 100,
    positionY: 200,
    width: 200,
    height: 150,
    zIndex: 1,
    version: 2,
    tags: [],
    content: { text: "Untitled" },
    ...overrides,
  } as CanvasItem;
}

const NOTE = makeItem({
  id: "note-1",
  type: ItemType.NOTE,
  tags: ["research", "q3"],
  content: { text: "Quarterly planning notes" },
});

const BOOKMARK = makeItem({
  id: "bookmark-1",
  type: ItemType.BOOKMARK,
  content: {
    url: "https://example.com/a",
    title: "Example article",
    description: "A useful reference",
  },
});

/** The focusable row for an item, as a keyboard user would reach it. */
function rowFor(item: CanvasItem): HTMLElement {
  const heading = describeItemHeading(item);
  return screen.getByLabelText(`${item.type.toLowerCase()}: ${heading}`);
}

function liveRegionText(): string {
  return document.querySelector('[aria-live="polite"]')?.textContent ?? "";
}

afterEach(() => {
  cleanup();
});

describe("the item list represents canvas content as real DOM", () => {
  it("names the region and reports how many items there are", () => {
    render(
      <CanvasItemListView
        items={[NOTE, BOOKMARK]}
        capabilities={EDITOR}
        canvasName="Roadmap"
      />,
    );

    expect(
      screen.getByRole("region", { name: /items on roadmap/i }),
    ).toBeTruthy();
    expect(screen.getByText(/2 items/i)).toBeTruthy();
  });

  it("exposes each item with its type, heading, summary, and tags", () => {
    render(
      <CanvasItemListView items={[NOTE, BOOKMARK]} capabilities={EDITOR} />,
    );

    expect(
      screen.getByRole("heading", { name: "Quarterly planning notes" }),
    ).toBeTruthy();
    expect(
      screen.getByRole("heading", { name: "Example article" }),
    ).toBeTruthy();
    expect(screen.getByText("A useful reference")).toBeTruthy();

    const tagGroup = screen.getByLabelText("Tags: research, q3");
    expect(within(tagGroup).getByText("research")).toBeTruthy();
    expect(within(tagGroup).getByText("q3")).toBeTruthy();
  });

  it("puts every item in the tab order so Tab traversal reaches them", () => {
    render(
      <CanvasItemListView items={[NOTE, BOOKMARK]} capabilities={EDITOR} />,
    );

    for (const item of [NOTE, BOOKMARK]) {
      expect(rowFor(item).getAttribute("tabindex")).toBe("0");
    }
  });

  it("says so plainly when a canvas has no items", () => {
    render(<CanvasItemListView items={[]} capabilities={EDITOR} />);

    expect(screen.getByText(/no items yet/i)).toBeTruthy();
  });

  it("describes a connection by what it links, not by coordinates", () => {
    const arrow = makeItem({
      id: "arrow-1",
      type: ItemType.ARROW,
      content: { startItemId: NOTE.id, endItemId: BOOKMARK.id },
    });
    const itemsById = new Map([
      [NOTE.id, NOTE],
      [BOOKMARK.id, BOOKMARK],
    ]);

    const detail = describeItemDetail(arrow, itemsById);

    expect(detail).toContain("Quarterly planning notes");
    expect(detail).toContain("Example article");
    expect(detail).not.toMatch(/\d+\s*,\s*\d+/);
  });

  it("gives every item type a non-empty heading", () => {
    for (const type of Object.values(ItemType)) {
      const heading = describeItemHeading(makeItem({ id: `x-${type}`, type }));
      expect(heading.length).toBeGreaterThan(0);
    }
  });
});

describe("keyboard operation without pointer or canvas pixels", () => {
  it("opens the focused item with Enter", () => {
    const onActivateItem = vi.fn();

    render(
      <CanvasItemListView
        items={[NOTE, BOOKMARK]}
        capabilities={EDITOR}
        onActivateItem={onActivateItem}
      />,
    );

    fireEvent.keyDown(rowFor(NOTE), { key: "Enter" });

    expect(onActivateItem).toHaveBeenCalledWith(NOTE);
  });

  it.each([
    ["ArrowRight", 1, 0],
    ["ArrowLeft", -1, 0],
    ["ArrowDown", 0, 1],
    ["ArrowUp", 0, -1],
  ])("nudges by one step with %s", (key, deltaX, deltaY) => {
    const onNudgeItem = vi.fn();

    render(
      <CanvasItemListView
        items={[NOTE]}
        capabilities={EDITOR}
        onNudgeItem={onNudgeItem}
      />,
    );

    fireEvent.keyDown(rowFor(NOTE), { key });

    expect(onNudgeItem).toHaveBeenCalledWith(NOTE, deltaX, deltaY);
  });

  it("nudges by a larger step when Shift is held", () => {
    const onNudgeItem = vi.fn();

    render(
      <CanvasItemListView
        items={[NOTE]}
        capabilities={EDITOR}
        onNudgeItem={onNudgeItem}
      />,
    );

    fireEvent.keyDown(rowFor(NOTE), { key: "ArrowRight", shiftKey: true });

    expect(onNudgeItem).toHaveBeenCalledWith(NOTE, 10, 0);
  });

  it("deletes the focused item and points at recovery", () => {
    const onDeleteItem = vi.fn();

    render(
      <CanvasItemListView
        items={[NOTE]}
        capabilities={EDITOR}
        onDeleteItem={onDeleteItem}
      />,
    );

    fireEvent.keyDown(rowFor(NOTE), { key: "Delete" });

    expect(onDeleteItem).toHaveBeenCalledWith(NOTE);
    expect(liveRegionText()).toMatch(/recover it from trash/i);
  });

  it("announces the outcome of a move through a live region", () => {
    render(
      <CanvasItemListView
        items={[NOTE]}
        capabilities={EDITOR}
        onNudgeItem={vi.fn()}
      />,
    );

    fireEvent.keyDown(rowFor(NOTE), { key: "ArrowRight" });

    expect(liveRegionText()).toMatch(
      /moved quarterly planning notes to 101, 200/i,
    );
  });

  it("re-announces a repeated move so it is not swallowed", () => {
    render(
      <CanvasItemListView
        items={[NOTE]}
        capabilities={EDITOR}
        onNudgeItem={vi.fn()}
      />,
    );

    const row = rowFor(NOTE);
    fireEvent.keyDown(row, { key: "ArrowRight" });
    const first = liveRegionText();
    fireEvent.keyDown(row, { key: "ArrowRight" });
    const second = liveRegionText();

    expect(second).not.toBe(first);
  });

  it("selects on focus and marks the item as current", () => {
    const onSelectItem = vi.fn();

    render(
      <CanvasItemListView
        items={[NOTE]}
        capabilities={EDITOR}
        selectedItemIds={new Set([NOTE.id])}
        onSelectItem={onSelectItem}
      />,
    );

    const row = rowFor(NOTE);
    fireEvent.focus(row);

    expect(onSelectItem).toHaveBeenCalledWith(NOTE.id);
    expect(row.getAttribute("aria-current")).toBe("true");
  });
});

describe("capability gating in the accessible surface", () => {
  it("offers no editing affordances to a viewer", () => {
    render(<CanvasItemListView items={[NOTE]} capabilities={VIEWER} />);

    expect(screen.queryByRole("button", { name: "Edit" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Delete" })).toBeNull();
    expect(screen.queryByRole("button", { name: /add note/i })).toBeNull();
  });

  it("tells a viewer why a move did not happen instead of failing silently", () => {
    const onNudgeItem = vi.fn();

    render(
      <CanvasItemListView
        items={[NOTE]}
        capabilities={VIEWER}
        onNudgeItem={onNudgeItem}
      />,
    );

    fireEvent.keyDown(rowFor(NOTE), { key: "ArrowRight" });

    expect(onNudgeItem).not.toHaveBeenCalled();
    expect(liveRegionText()).toMatch(/cannot be moved/i);
  });

  it("never activates an edit for a role without edit rights", () => {
    const onActivateItem = vi.fn();

    render(
      <CanvasItemListView
        items={[NOTE]}
        capabilities={VIEWER}
        onActivateItem={onActivateItem}
      />,
    );

    fireEvent.keyDown(rowFor(NOTE), { key: "Enter" });

    expect(onActivateItem).not.toHaveBeenCalled();
    expect(liveRegionText()).toMatch(/read-only/i);
  });

  it("does not delete for a role without delete rights", () => {
    const onDeleteItem = vi.fn();

    render(
      <CanvasItemListView
        items={[NOTE]}
        capabilities={VIEWER}
        onDeleteItem={onDeleteItem}
      />,
    );

    fireEvent.keyDown(rowFor(NOTE), { key: "Delete" });

    expect(onDeleteItem).not.toHaveBeenCalled();
  });

  it("shows the create affordance only to roles that may create", () => {
    const { rerender } = render(
      <CanvasItemListView
        items={[NOTE]}
        capabilities={EDITOR}
        onCreateItem={vi.fn()}
      />,
    );
    expect(screen.getByRole("button", { name: /add note/i })).toBeTruthy();

    rerender(
      <CanvasItemListView
        items={[NOTE]}
        capabilities={NO_CANVAS_CAPABILITIES}
        onCreateItem={vi.fn()}
      />,
    );
    expect(screen.queryByRole("button", { name: /add note/i })).toBeNull();
  });
});

describe("the panel stays in the accessibility tree", () => {
  it("renders item content even when visually clipped, and offers a skip control", () => {
    render(
      <CanvasAccessiblePanel
        items={[NOTE]}
        capabilities={VIEWER}
        canvasName="Shared board"
      />,
    );

    // Never display:none / hidden — that would remove it from the a11y tree.
    expect(
      screen.getByRole("heading", { name: "Quarterly planning notes" }),
    ).toBeTruthy();
    expect(
      screen.getByRole("button", { name: /skip to accessible item list/i }),
    ).toBeTruthy();
    expect(document.querySelector("[hidden]")).toBeNull();
    expect(document.querySelector('[aria-hidden="true"]')).toBeNull();
  });

  it("works for a public canvas, where nothing is editable", () => {
    render(
      <CanvasAccessiblePanel
        items={[NOTE, BOOKMARK]}
        capabilities={NO_CANVAS_CAPABILITIES}
      />,
    );

    expect(screen.getByText(/2 items/i)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Delete" })).toBeNull();
  });
});
