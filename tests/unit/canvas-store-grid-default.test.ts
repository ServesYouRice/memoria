// @vitest-environment happy-dom
/** IMP-085: the canvas starts on faint dots; grid lines are opt-in. */
import { beforeEach, describe, expect, it, vi } from "vitest";

beforeEach(() => {
  vi.resetModules();
  localStorage.clear();
});

describe("canvas background default", () => {
  it("shows dots, not grid lines, for a new visitor", async () => {
    const { useCanvasStore } = await import("@/stores/canvasStore");
    expect(useCanvasStore.getState().gridVisible).toBe(false);
  });

  it("moves people on the old saved default to dots once", async () => {
    localStorage.setItem(
      "canvas-preferences",
      JSON.stringify({
        state: { gridVisible: true, snapToGrid: true },
        version: 0,
      }),
    );
    const { useCanvasStore } = await import("@/stores/canvasStore");
    await useCanvasStore.persist.rehydrate();
    expect(useCanvasStore.getState().gridVisible).toBe(false);
    expect(useCanvasStore.getState().snapToGrid).toBe(true);
  });

  it("keeps grid lines for someone who switched them on since", async () => {
    localStorage.setItem(
      "canvas-preferences",
      JSON.stringify({ state: { gridVisible: true }, version: 1 }),
    );
    const { useCanvasStore } = await import("@/stores/canvasStore");
    await useCanvasStore.persist.rehydrate();
    expect(useCanvasStore.getState().gridVisible).toBe(true);
  });
});
