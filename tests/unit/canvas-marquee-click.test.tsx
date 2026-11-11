// @vitest-environment happy-dom

import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/stores/canvasStore", () => ({
  useCanvasStore: () => ({ activeTool: "select", drawingState: {} }),
}));
vi.mock("@/lib/hooks/use-canvas-items", () => ({
  useCreateCanvasItem: () => ({ mutate: vi.fn() }),
}));

import { useCanvasInteraction } from "@/features/canvas/hooks/use-canvas-interaction";
import type { CanvasItem } from "@/types/canvas";

function stageEvent(point = { x: 0, y: 0 }) {
  const stage = {
    getPointerPosition: () => point,
    getRelativePointerPosition: () => point,
  } as Record<string, unknown>;
  stage.getStage = () => stage;
  return { target: stage, evt: {} } as never;
}

function setup(
  box: { x: number; y: number; width: number; height: number } | null,
) {
  const setSelectedItemIds = vi.fn();
  const setSelectedItemId = vi.fn();
  const item = {
    id: "a",
    positionX: 10,
    positionY: 10,
    width: 20,
    height: 20,
  } as CanvasItem;
  const hook = renderHook(
    ({ selecting }: { selecting: boolean }) =>
      useCanvasInteraction({
        canvasId: "c1",
        stageRef: { current: null } as never,
        activeTool: "select",
        canCreateItems: true,
        zoom: 1,
        position: { x: 0, y: 0 },
        isSelecting: selecting,
        startSelection: vi.fn(),
        updateSelection: vi.fn(),
        endSelection: vi.fn(() => box),
        isItemInSelection: vi.fn(() => true),
        items: [item],
        setSelectedItemIds,
        setSelectedItemId,
      }),
    { initialProps: { selecting: false } },
  );
  return { hook, setSelectedItemIds };
}

describe("stage click after a marquee drag", () => {
  it("keeps the marquee selection on the click that follows mouse-up", () => {
    const { hook, setSelectedItemIds } = setup({
      x: 0,
      y: 0,
      width: 100,
      height: 100,
    });
    act(() => hook.result.current.handleStageMouseDown(stageEvent()));
    hook.rerender({ selecting: true });
    act(() =>
      hook.result.current.handleStageMouseMove(stageEvent({ x: 100, y: 100 })),
    );
    act(() => hook.result.current.handleStageMouseUp(stageEvent()));
    hook.rerender({ selecting: false });
    act(() => hook.result.current.handleStageClick(stageEvent()));
    expect(setSelectedItemIds).toHaveBeenCalledTimes(1);
    expect([...setSelectedItemIds.mock.calls[0][0]]).toEqual(["a"]);
  });

  it("still clears the selection on a plain click on empty space", () => {
    const { hook, setSelectedItemIds } = setup(null);
    act(() => hook.result.current.handleStageMouseDown(stageEvent()));
    hook.rerender({ selecting: true });
    act(() => hook.result.current.handleStageMouseUp(stageEvent()));
    hook.rerender({ selecting: false });
    act(() => hook.result.current.handleStageClick(stageEvent()));
    expect(setSelectedItemIds).toHaveBeenCalledTimes(1);
    expect(setSelectedItemIds.mock.calls[0][0].size).toBe(0);
  });
});
