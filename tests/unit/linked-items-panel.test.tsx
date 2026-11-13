// @vitest-environment happy-dom

import React from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ItemType, type CanvasItem } from "@/types/canvas";
import { LinkedItemsPanel } from "@/features/canvas/components/LinkedItemsPanel";
import { ArrowLabelDialog } from "@/features/canvas/components/ArrowLabelDialog";

afterEach(cleanup);

function item(id: string, overrides: Partial<CanvasItem> = {}): CanvasItem {
  return {
    id,
    canvasId: "c1",
    type: ItemType.NOTE,
    positionX: 0,
    positionY: 0,
    width: 100,
    height: 100,
    zIndex: 1,
    version: 1,
    content: { text: `${id} note` },
    tags: [],
    createdAt: "",
    updatedAt: "",
    ...overrides,
  } as CanvasItem;
}

describe("Linked to panel (IMP-095)", () => {
  const a = item("a");
  const b = item("b");
  const arrow = item("x", {
    type: ItemType.ARROW,
    content: { startItemId: "a", endItemId: "b", label: "then" },
  });

  it("lists what the item links to and jumps there", () => {
    const onJump = vi.fn();
    render(
      <LinkedItemsPanel itemId="a" items={[a, b, arrow]} onJump={onJump} />,
    );
    expect(screen.getByText("Linked to")).toBeTruthy();
    expect(screen.getByText("then")).toBeTruthy();
    fireEvent.click(screen.getByText("→ b note"));
    expect(onJump).toHaveBeenCalledWith(b);
  });

  it("shows nothing for an item without links", () => {
    const { container } = render(
      <LinkedItemsPanel itemId="b" items={[a, b]} onJump={vi.fn()} />,
    );
    expect(container.textContent).toBe("");
  });
});

describe("arrow label dialog (IMP-095)", () => {
  it("saves a trimmed label and the line style, and clears an empty label", () => {
    const onSave = vi.fn();
    const { rerender } = render(
      <ArrowLabelDialog
        content={{ startItemId: "a", endItemId: "b", label: "old" }}
        onClose={vi.fn()}
        onSave={onSave}
      />,
    );
    fireEvent.change(screen.getByLabelText("Label"), {
      target: { value: "  leads to  " },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(onSave).toHaveBeenLastCalledWith({
      startItemId: "a",
      endItemId: "b",
      label: "leads to",
    });

    rerender(
      <ArrowLabelDialog
        content={{ label: "x", lineStyle: "DASHED" }}
        onClose={vi.fn()}
        onSave={onSave}
      />,
    );
    fireEvent.change(screen.getByLabelText("Label"), { target: { value: "" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(onSave).toHaveBeenLastCalledWith({ lineStyle: "DASHED" });
  });
});
