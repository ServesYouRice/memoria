// @vitest-environment happy-dom

import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { resolveCanvasCapabilities } from "@/types/canvas";

const store = vi.hoisted(() => ({
  activeTool: "draw",
  drawingState: { color: "#000", strokeWidth: 2, tool: "pen" },
}));
const createItem = vi.hoisted(() => vi.fn());
vi.mock("@/stores/canvasStore", () => ({ useCanvasStore: () => store }));
vi.mock("@/lib/hooks/use-canvas-items", () => ({
  useCreateCanvasItem: () => ({ mutate: createItem }),
}));

import {
  resolveEffectiveTool,
  useCanvasInteraction,
} from "@/features/canvas/hooks/use-canvas-interaction";
import { useDrawingInteraction } from "@/features/canvas/hooks/use-drawing-interaction";

function stageEvent(point = { x: 10, y: 10 }) {
  const stage = {
    getPointerPosition: () => point,
    getRelativePointerPosition: () => point,
  } as Record<string, unknown>;
  stage.getStage = () => stage;
  return { target: stage, evt: {} } as never;
}

function interaction(canCreateItems: boolean) {
  const startSelection = vi.fn();
  const hook = renderHook(() =>
    useCanvasInteraction({
      canvasId: "c1",
      stageRef: { current: null } as never,
      activeTool: store.activeTool,
      canCreateItems,
      zoom: 1,
      position: { x: 0, y: 0 },
      isSelecting: false,
      startSelection,
      updateSelection: vi.fn(),
      endSelection: vi.fn(() => null),
      isItemInSelection: vi.fn(() => false),
      items: [],
      setSelectedItemIds: vi.fn(),
      setSelectedItemId: vi.fn(),
    }),
  );
  return { hook, startSelection };
}

describe("drawing tools need the create capability", () => {
  beforeEach(() => {
    createItem.mockReset();
    store.activeTool = "draw";
  });

  it("resolves draw/shape/arrow to select without canCreateItems", () => {
    for (const level of ["VIEW", "COMMENT"] as const) {
      const caps = resolveCanvasCapabilities(level);
      for (const tool of ["draw", "shape", "arrow"]) {
        expect(resolveEffectiveTool(tool, caps)).toBe("select");
      }
    }
    const edit = resolveCanvasCapabilities("EDIT");
    expect(resolveEffectiveTool("draw", edit)).toBe("draw");
    expect(resolveEffectiveTool("shape", edit)).toBe("shape");
  });

  it("starts marquee selection, not a stroke, for a read-only user with a saved draw tool", () => {
    const { hook, startSelection } = interaction(false);
    act(() => hook.result.current.handleStageMouseDown(stageEvent()));
    act(() =>
      hook.result.current.handleStageMouseMove(stageEvent({ x: 40, y: 40 })),
    );
    act(() => hook.result.current.handleStageMouseUp(stageEvent()));
    expect(startSelection).toHaveBeenCalled();
    expect(hook.result.current.isDrawing).toBe(false);
    expect(createItem).not.toHaveBeenCalled();
  });

  it("still draws for editors", () => {
    const { hook, startSelection } = interaction(true);
    act(() => hook.result.current.handleStageMouseDown(stageEvent()));
    expect(startSelection).not.toHaveBeenCalled();
    expect(hook.result.current.isDrawing).toBe(true);
  });

  it("useDrawingInteraction refuses to create without the capability", () => {
    store.activeTool = "shape";
    const { result } = renderHook(() =>
      useDrawingInteraction({ canvasId: "c1", canCreateItems: false }),
    );
    act(() => result.current.handleMouseDown(stageEvent({ x: 0, y: 0 })));
    act(() => result.current.handleMouseMove(stageEvent({ x: 50, y: 50 })));
    act(() => result.current.handleMouseUp());
    expect(createItem).not.toHaveBeenCalled();
  });
});
