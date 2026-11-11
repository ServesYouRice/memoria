// @vitest-environment happy-dom
/**
 * TASK-109 — keys pressed on a row's Edit/Delete buttons belong to the
 * buttons, not to the row's keyboard commands.
 */

import React from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  CanvasItemListView,
  describeItemHeading,
} from "@/features/canvas/components/CanvasItemListView";
import {
  ItemType,
  resolveCanvasCapabilities,
  type CanvasItem,
} from "@/types/canvas";

const NOTE = {
  id: "note-1",
  canvasId: "canvas-1",
  type: ItemType.NOTE,
  positionX: 100,
  positionY: 200,
  width: 200,
  height: 150,
  zIndex: 1,
  version: 2,
  tags: [],
  content: { text: "Planning notes" },
} as unknown as CanvasItem;

function rowFor(item: CanvasItem): HTMLElement {
  return screen.getByLabelText(
    `${item.type.toLowerCase()}: ${describeItemHeading(item)}`,
  );
}

afterEach(cleanup);

function renderList(capability: "EDIT" | "VIEW" = "EDIT") {
  const handlers = {
    onActivateItem: vi.fn(),
    onDeleteItem: vi.fn(),
    onNudgeItem: vi.fn(),
  };
  render(
    <CanvasItemListView
      items={[NOTE]}
      capabilities={resolveCanvasCapabilities(capability)}
      {...handlers}
    />,
  );
  return handlers;
}

describe("CanvasItemListView row buttons", () => {
  it("leaves Enter, Space and arrows on the Delete button to the button", () => {
    const handlers = renderList();
    const remove = screen.getByRole("button", { name: "Delete" });

    for (const key of ["Enter", " ", "ArrowLeft", "Backspace"]) {
      // fireEvent returns false when a handler called preventDefault, which
      // would cancel the button's native keyboard activation.
      expect(fireEvent.keyDown(remove, { key })).toBe(true);
    }
    expect(handlers.onActivateItem).not.toHaveBeenCalled();
    expect(handlers.onNudgeItem).not.toHaveBeenCalled();
    expect(handlers.onDeleteItem).not.toHaveBeenCalled();

    fireEvent.click(remove);
    expect(handlers.onDeleteItem).toHaveBeenCalledTimes(1);
  });

  it("leaves Enter on the Edit button to the button", () => {
    const handlers = renderList();
    const edit = screen.getByRole("button", { name: "Edit" });
    expect(fireEvent.keyDown(edit, { key: "Enter" })).toBe(true);
    expect(handlers.onActivateItem).not.toHaveBeenCalled();
  });

  it("still runs row commands when the row itself has focus", () => {
    const handlers = renderList();
    fireEvent.keyDown(rowFor(NOTE), { key: "Enter" });
    expect(handlers.onActivateItem).toHaveBeenCalledWith(NOTE);
    fireEvent.keyDown(rowFor(NOTE), { key: "Delete" });
    expect(handlers.onDeleteItem).toHaveBeenCalledWith(NOTE);
  });
});
