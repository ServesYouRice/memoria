// @vitest-environment happy-dom

import type React from "react";
import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

const store = vi.hoisted(() => ({
  activeTool: "draw",
  drawingState: { color: "#123456", strokeWidth: 3, opacity: 1 },
}));
const createItem = vi.hoisted(() => vi.fn());
vi.mock("@/stores/canvasStore", () => ({ useCanvasStore: () => store }));
vi.mock("@/lib/hooks/use-canvas-items", () => ({
  useCreateCanvasItem: () => ({ mutate: createItem }),
}));

import { DrawingPreview } from "@/features/canvas/components/DrawingPreview";
import { useDrawingInteraction } from "@/features/canvas/hooks/use-drawing-interaction";

type Node = React.ReactElement<{
  listening?: boolean;
  children?: React.ReactNode;
  points?: number[];
  stroke?: string;
}>;

function stageEvent(point: { x: number; y: number }) {
  const stage = { getRelativePointerPosition: () => point } as Record<
    string,
    unknown
  >;
  stage.getStage = () => stage;
  return { target: stage } as never;
}

describe("DrawingPreview", () => {
  it("renders a non-listening pen stroke while drawing and nothing afterwards", () => {
    store.activeTool = "draw";
    const { result } = renderHook(() =>
      useDrawingInteraction({ canvasId: "c1", canCreateItems: true }),
    );
    act(() => result.current.handleMouseDown(stageEvent({ x: 0, y: 0 })));
    act(() => result.current.handleMouseMove(stageEvent({ x: 5, y: 5 })));
    act(() => result.current.handleMouseMove(stageEvent({ x: 9, y: 2 })));

    const preview = DrawingPreview({
      currentPath: result.current.currentPath,
      currentCreation: result.current.currentCreation,
      zoom: 1,
    }) as Node;
    expect(preview).not.toBeNull();
    expect(preview.props.listening).toBe(false);
    const line = preview.props.children as Node;
    expect(line.props.points).toEqual([0, 0, 5, 5, 9, 2]);
    expect(line.props.stroke).toBe("#123456");

    act(() => result.current.handleMouseUp());
    expect(createItem).toHaveBeenCalledTimes(1);
    expect(
      DrawingPreview({
        currentPath: result.current.currentPath,
        currentCreation: result.current.currentCreation,
        zoom: 1,
      }),
    ).toBeNull();
  });

  it("renders a shape outline during a shape drag", () => {
    const preview = DrawingPreview({
      currentPath: null,
      currentCreation: { type: "shape", x: 10, y: 20, width: 30, height: 40 },
      zoom: 2,
    }) as Node;
    expect(preview.props.listening).toBe(false);
    const rect = preview.props.children as React.ReactElement<
      Record<string, number>
    >;
    expect(rect.props).toMatchObject({ x: 10, y: 20, width: 30, height: 40 });
  });
});
