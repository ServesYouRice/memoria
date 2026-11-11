// @vitest-environment happy-dom
/**
 * Arrow-key nudges go through useItemGeometry's per-item queue: two quick
 * presses give one in-flight write, then one write carrying the version the
 * first returned, and the moves accumulate.
 */
import type React from "react";
import type Konva from "konva";
import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useCanvasKeyboard } from "@/features/canvas/hooks/use-canvas-keyboard";
import { useItemGeometry } from "@/features/canvas/hooks/use-item-geometry";
import {
  ItemType,
  resolveCanvasCapabilities,
  type CanvasItem,
} from "@/types/canvas";

const mutateAsync = vi.fn();
vi.mock("@/lib/hooks/use-canvas-items", () => ({
  useUpdateCanvasItem: () => ({ mutateAsync }),
}));

const item = {
  id: "cnote",
  canvasId: "ccanvas",
  type: ItemType.NOTE,
  positionX: 100,
  positionY: 100,
  width: 200,
  height: 100,
  zIndex: 0,
  version: 3,
  content: {},
} as unknown as CanvasItem;

function press(key: string) {
  window.dispatchEvent(
    new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }),
  );
}

beforeEach(() => mutateAsync.mockReset());
afterEach(() => {
  document.body.innerHTML = "";
});

describe("keyboard nudges", () => {
  it("serialize through the geometry queue with the updated version", async () => {
    let release: (value: { version: number }) => void = () => {};
    mutateAsync
      .mockImplementationOnce(
        () =>
          new Promise<{ version: number }>((resolve) => {
            release = resolve;
          }),
      )
      .mockResolvedValue({ version: 5 });

    renderHook(() => {
      const geometry = useItemGeometry({
        capabilities: resolveCanvasCapabilities("EDIT"),
      });
      useCanvasKeyboard({
        onDelete: vi.fn(),
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
        nudgeItem: geometry.nudgeGeometry,
      });
    });

    press("ArrowRight");
    press("ArrowRight");
    expect(mutateAsync).toHaveBeenCalledTimes(1);
    expect(mutateAsync).toHaveBeenLastCalledWith({
      itemId: item.id,
      data: { positionX: 101, positionY: 100, version: 3 },
    });

    await act(async () => release({ version: 4 }));
    await waitFor(() => expect(mutateAsync).toHaveBeenCalledTimes(2));
    expect(mutateAsync).toHaveBeenLastCalledWith({
      itemId: item.id,
      data: { positionX: 102, positionY: 100, version: 4 },
    });
  });
});
