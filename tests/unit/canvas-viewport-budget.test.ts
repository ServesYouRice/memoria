import { describe, expect, it, vi } from "vitest";
import {
  calculateViewportWindow,
  canvasViewportStorageKey,
  readCanvasViewport,
  writeCanvasViewport,
} from "@/features/canvas/viewport-budget";

describe("canvas viewport resource boundary", () => {
  it("uses canvas-scoped keys so navigation cannot leak another canvas position", () => {
    expect(canvasViewportStorageKey("canvas-a")).not.toBe(
      canvasViewportStorageKey("canvas-b"),
    );
  });

  it("falls back safely when browser storage reads or cleanup throw", () => {
    const fallback = { zoom: 0.75, x: 20, y: -10 };
    const storage = {
      getItem: vi.fn(() => {
        throw new DOMException("denied");
      }),
      removeItem: vi.fn(() => {
        throw new DOMException("denied");
      }),
    };

    expect(readCanvasViewport(storage, "canvas-a", fallback)).toEqual(fallback);
  });

  it("treats writes as non-blocking best effort", () => {
    const storage = {
      setItem: vi.fn(() => {
        throw new DOMException("quota");
      }),
    };
    expect(() =>
      writeCanvasViewport(storage, "canvas-a", { zoom: 1, x: 0, y: 0 }),
    ).not.toThrow();
  });

  it("quantizes a padded viewport so small pan frames do not create traffic", () => {
    const first = calculateViewportWindow({
      zoom: 1,
      position: { x: 0, y: 0 },
      size: { width: 800, height: 600 },
      tags: ["z", "a"],
    });
    const nextFrame = calculateViewportWindow({
      zoom: 1,
      position: { x: 2, y: 2 },
      size: { width: 800, height: 600 },
      tags: ["z", "a"],
    });

    expect(nextFrame).toEqual(first);
    expect(first.tags).toEqual(["a", "z"]);
    expect(first.limit).toBe(250);
    expect(first.maxX - first.minX).toBeGreaterThan(800);
  });
});
