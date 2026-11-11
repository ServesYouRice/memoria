// @vitest-environment happy-dom

import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const store = vi.hoisted(() => ({
  activeTool: "arrow",
  drawingState: { color: "#000", strokeWidth: 2, opacity: 1 },
}));
const createItem = vi.hoisted(() => vi.fn());
vi.mock("@/stores/canvasStore", () => ({ useCanvasStore: () => store }));
vi.mock("@/lib/hooks/use-canvas-items", () => ({
  useCreateCanvasItem: () => ({ mutate: createItem }),
}));

import { useDrawingInteraction } from "@/features/canvas/hooks/use-drawing-interaction";

function at(point: { x: number; y: number }) {
  const stage = { getRelativePointerPosition: () => point } as Record<
    string,
    unknown
  >;
  stage.getStage = () => stage;
  return { target: stage } as never;
}

function drag(
  tool: "arrow" | "shape",
  from: { x: number; y: number },
  to: { x: number; y: number },
) {
  store.activeTool = tool;
  const { result } = renderHook(() =>
    useDrawingInteraction({ canvasId: "c1", canCreateItems: true }),
  );
  act(() => result.current.handleMouseDown(at(from)));
  act(() => result.current.handleMouseMove(at(to)));
  act(() => result.current.handleMouseUp());
}

describe("arrow creation", () => {
  beforeEach(() => createItem.mockReset());

  it.each([
    ["left-to-right down", { x: 10, y: 10 }, { x: 60, y: 40 }],
    ["right-to-left", { x: 60, y: 10 }, { x: 10, y: 40 }],
    ["bottom-to-top", { x: 10, y: 40 }, { x: 60, y: 10 }],
    ["up-left", { x: 60, y: 40 }, { x: 10, y: 10 }],
  ])("keeps the drag direction (%s)", (_name, from, to) => {
    drag("arrow", from, to);
    expect(createItem).toHaveBeenCalledTimes(1);
    const payload = createItem.mock.calls[0][0];
    expect(payload.type).toBe("ARROW");
    expect(payload.positionX).toBe(Math.min(from.x, to.x));
    expect(payload.positionY).toBe(Math.min(from.y, to.y));
    expect(payload.content.startPoint).toEqual({
      x: from.x - payload.positionX,
      y: from.y - payload.positionY,
    });
    expect(payload.content.endPoint).toEqual({
      x: to.x - payload.positionX,
      y: to.y - payload.positionY,
    });
  });

  it("creates horizontal and vertical arrows with positive dimensions", () => {
    drag("arrow", { x: 0, y: 0 }, { x: 50, y: 0 });
    drag("arrow", { x: 0, y: 50 }, { x: 0, y: 0 });
    expect(createItem).toHaveBeenCalledTimes(2);
    for (const [payload] of createItem.mock.calls) {
      expect(payload.width).toBeGreaterThan(0);
      expect(payload.height).toBeGreaterThan(0);
    }
    expect(createItem.mock.calls[1][0].content.endPoint).toEqual({
      x: 0,
      y: 0,
    });
  });

  it("ignores an arrow drag of 5 units or less", () => {
    drag("arrow", { x: 0, y: 0 }, { x: 3, y: 0 });
    expect(createItem).not.toHaveBeenCalled();
  });

  it("leaves shape creation and its threshold unchanged", () => {
    drag("shape", { x: 0, y: 0 }, { x: 20, y: 20 });
    expect(createItem).toHaveBeenCalledTimes(1);
    expect(createItem.mock.calls[0][0].content).toEqual({
      shapeType: "rectangle",
      fill: "transparent",
      stroke: "#000000",
      strokeWidth: 2,
    });
    drag("shape", { x: 0, y: 0 }, { x: 20, y: 3 });
    expect(createItem).toHaveBeenCalledTimes(1);
  });
});
