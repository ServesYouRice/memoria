// @vitest-environment happy-dom
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  canvas: null as null | Record<string, unknown>,
  updateCanvas: vi.fn(async () => ({})),
}));

vi.mock("@/lib/hooks/use-canvases", () => ({
  useCanvas: () => ({ data: state.canvas, error: null, refetch: vi.fn() }),
  useUpdateCanvas: () => ({ mutateAsync: state.updateCanvas }),
}));
vi.mock("@/lib/hooks/use-canvas-items", () => ({
  useCanvasItems: () => ({
    data: { items: [], total: 0 },
    error: null,
    refetch: vi.fn(),
  }),
}));
vi.mock("@/lib/hooks/use-canvas-versions", () => ({
  useCanvasVersions: () => ({ data: { versions: [] } }),
  useCanvasVersion: () => ({ data: undefined }),
}));
vi.mock("@/lib/hooks/use-canvas-index", () => ({
  useCanvasGeometry: () => ({ data: { items: [] }, refetch: vi.fn() }),
  useCanvasIndexSummary: () => ({ data: undefined, refetch: vi.fn() }),
  useCanvasSearch: () => ({ data: undefined }),
}));

import { useCanvasData } from "@/features/canvas/hooks/use-canvas-data";

const viewportSize = { width: 1200, height: 800 };

describe("useCanvasData viewport persistence", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    window.localStorage.clear();
    state.updateCanvas.mockClear();
    state.canvas = {
      id: "canvas-1",
      name: "Board",
      zoomLevel: 1.5,
      panX: -320,
      panY: 140,
      accessLevel: "OWNER",
    };
    // Run the idle callback through the fake timers.
    vi.stubGlobal("requestIdleCallback", (run: () => void) =>
      window.setTimeout(run, 0),
    );
    vi.stubGlobal("cancelIdleCallback", (id: number) =>
      window.clearTimeout(id),
    );
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("does not save the stored viewport back when a canvas opens", async () => {
    renderHook(() => useCanvasData({ canvasId: "canvas-1", viewportSize }));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3_000);
    });
    expect(state.updateCanvas).not.toHaveBeenCalled();
  });

  it("still saves a real pan by the owner, once", async () => {
    const { result } = renderHook(() =>
      useCanvasData({ canvasId: "canvas-1", viewportSize }),
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3_000);
    });
    act(() => result.current.setPosition({ x: 10, y: 20 }));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3_000);
    });
    expect(state.updateCanvas).toHaveBeenCalledTimes(1);
    expect(state.updateCanvas).toHaveBeenCalledWith({
      canvasId: "canvas-1",
      data: { defaultViewport: { zoomLevel: 1.5, panX: 10, panY: 20 } },
    });
  });

  it("never saves the viewport for a non-owner", async () => {
    state.canvas = { ...state.canvas, accessLevel: "EDIT" };
    const { result } = renderHook(() =>
      useCanvasData({ canvasId: "canvas-1", viewportSize }),
    );
    act(() => result.current.setPosition({ x: 10, y: 20 }));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3_000);
    });
    expect(state.updateCanvas).not.toHaveBeenCalled();
  });
});
