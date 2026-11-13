// @vitest-environment happy-dom
/**
 * IMP-103: loading the items of a new viewport tile (after a zoom or a long
 * pan) keeps the board on screen; it must not suspend to the skeleton.
 */
import { Suspense, useEffect, type ReactNode } from "react";
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const tiles = vi.hoisted(() => ({
  loaded: new Set<string>(),
  pending: new Map<string, Promise<void>>(),
  release: new Map<string, () => void>(),
}));

vi.mock("@/lib/hooks/use-canvases", () => ({
  useCanvas: () => ({
    data: { id: "canvas-1", name: "Board", accessLevel: "OWNER" },
    error: null,
    refetch: vi.fn(),
  }),
  useUpdateCanvas: () => ({ mutateAsync: vi.fn(async () => ({})) }),
}));
// Suspends like useSuspenseQuery for a viewport it has not loaded yet.
vi.mock("@/lib/hooks/use-canvas-items", () => ({
  useCanvasItems: (_id: string, _type: unknown, viewport: unknown) => {
    const key = JSON.stringify(viewport);
    if (!tiles.loaded.has(key)) {
      let promise = tiles.pending.get(key);
      if (!promise) {
        promise = new Promise<void>((resolve) =>
          tiles.release.set(key, () => {
            tiles.loaded.add(key);
            resolve();
          }),
        );
        tiles.pending.set(key, promise);
      }
      throw promise;
    }
    return { data: { items: [], total: 0 }, error: null, refetch: vi.fn() };
  },
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

const board = { setZoom: (_zoom: number) => {} };

function Board() {
  const data = useCanvasData({
    canvasId: "canvas-1",
    viewportSize: { width: 1200, height: 800 },
  });
  useEffect(() => {
    board.setZoom = data.setZoom;
  });
  return <p>board at {data.zoom}</p>;
}

function releaseAll() {
  for (const release of tiles.release.values()) release();
}

afterEach(() => {
  cleanup();
  tiles.loaded.clear();
  tiles.pending.clear();
  tiles.release.clear();
});

describe("useCanvasData tile loading (IMP-103)", () => {
  it("keeps the board shown while a new tile loads", async () => {
    const wrap = (child: ReactNode) => (
      <Suspense fallback={<p>skeleton</p>}>{child}</Suspense>
    );
    render(wrap(<Board />));
    expect(screen.getByText("skeleton")).toBeTruthy();
    await act(async () => releaseAll());
    expect(screen.getByText("board at 1")).toBeTruthy();

    const before = tiles.pending.size;
    await act(async () => board.setZoom(0.25));
    // A new tile was asked for, and the board stayed on screen meanwhile.
    expect(tiles.pending.size).toBeGreaterThan(before);
    expect(screen.queryByText("skeleton")).toBeNull();
    expect(screen.getByText(/board at/)).toBeTruthy();

    await act(async () => releaseAll());
    expect(screen.getByText("board at 0.25")).toBeTruthy();
  });
});
