// @vitest-environment happy-dom
/**
 * The canvas's global shortcuts must not act on a key a focused surface has
 * already handled: the accessible item list nudges and deletes the focused
 * (and so selected) item itself. Found by the IMP-042 co-editing E2E run,
 * where one ArrowRight moved a note twice.
 */
import type React from "react";
import type Konva from "konva";
import { afterEach, describe, expect, it, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import { useCanvasKeyboard } from "@/features/canvas/hooks/use-canvas-keyboard";
import { type CanvasItem, ItemType } from "@/types/canvas";

const item = {
  id: "cnote",
  canvasId: "ccanvas",
  type: ItemType.NOTE,
  positionX: 120,
  positionY: 120,
  width: 240,
  height: 180,
  zIndex: 0,
  version: 1,
  tags: [],
  content: { formatVersion: 1, document: { type: "doc", content: [] } },
} as unknown as CanvasItem;

function renderKeyboard() {
  const updateItem = vi.fn();
  const onDelete = vi.fn();
  renderHook(() =>
    useCanvasKeyboard({
      onDelete,
      onCopy: vi.fn(),
      onPaste: vi.fn(),
      onSelectAll: vi.fn(),
      onDuplicate: vi.fn(),
      onEscape: vi.fn(),
      canEdit: true,
      isDrawing: false,
      stageRef: { current: null } as unknown as React.RefObject<Konva.Stage>,
      onChatOpen: vi.fn(),
      onReactionOpen: vi.fn(),
      selectedItemIds: new Set<string>(),
      selectedItemId: item.id,
      allItems: [item],
      updateItem,
    }),
  );
  return { updateItem, onDelete };
}

/** Press a key on a focusable row, optionally handling it there. */
function pressOnRow(key: string, handledByRow: boolean) {
  const row = document.createElement("div");
  row.tabIndex = 0;
  document.body.appendChild(row);
  if (handledByRow)
    row.addEventListener("keydown", (event) => event.preventDefault());
  row.dispatchEvent(
    new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }),
  );
}

afterEach(() => {
  document.body.innerHTML = "";
});

describe("useCanvasKeyboard", () => {
  it("moves the selected item with an arrow key nothing else handled", () => {
    const { updateItem } = renderKeyboard();
    pressOnRow("ArrowRight", false);
    expect(updateItem).toHaveBeenCalledTimes(1);
    expect(updateItem).toHaveBeenCalledWith({
      itemId: item.id,
      data: { positionX: 121, positionY: 120, version: 1 },
    });
  });

  it("leaves keys a focused surface already handled", () => {
    const { updateItem, onDelete } = renderKeyboard();
    pressOnRow("ArrowRight", true);
    pressOnRow("Delete", true);
    expect(updateItem).not.toHaveBeenCalled();
    expect(onDelete).not.toHaveBeenCalled();
  });
});
