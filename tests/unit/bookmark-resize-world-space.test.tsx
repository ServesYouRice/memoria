// @vitest-environment happy-dom
/**
 * TASK-069 — bookmark corner resize uses the world-space pointer, so it is
 * correct under Stage zoom and pan.
 */

import React from "react";
import { act, cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

type Handlers = Record<string, (event: unknown) => void>;
const circles = vi.hoisted(() => ({ list: [] as Handlers[] }));

vi.mock("react-konva", () => {
  const passthrough = ({ children }: { children?: React.ReactNode }) => (
    <div>{children}</div>
  );
  return {
    Group: React.forwardRef(function Group(
      { children }: { children?: React.ReactNode },
      _ref,
    ) {
      return <div>{children}</div>;
    }),
    Rect: passthrough,
    Text: passthrough,
    Image: passthrough,
    Circle: (props: Handlers) => {
      circles.list.push(props);
      return null;
    },
  };
});

import {
  BookmarkItem,
  resizeFromCorner,
} from "@/features/canvas/components/BookmarkItem";

/** A Stage zoomed by `zoom` and panned by `pan`, pointer at `screen`. */
function stageEvent(
  screen: { x: number; y: number },
  zoom: number,
  pan: { x: number; y: number },
) {
  const world = { x: (screen.x - pan.x) / zoom, y: (screen.y - pan.y) / zoom };
  const stage = {
    getPointerPosition: () => screen,
    getRelativePointerPosition: () => world,
  };
  return { target: { getStage: () => stage } };
}

function renderBookmark(onCommitGeometry: (g: unknown) => void) {
  circles.list = [];
  render(
    <BookmarkItem
      item={
        {
          id: "b1",
          canvasId: "c1",
          type: "BOOKMARK",
          positionX: 50,
          positionY: 50,
          width: 300,
          height: 150,
          zIndex: 0,
          content: { url: "https://example.com" },
          tags: [],
        } as never
      }
      isSelected
      capabilities={{ canMoveItems: true, canResizeItems: true } as never}
      onSelect={() => undefined}
      onContextMenu={() => undefined}
      onCommitGeometry={onCommitGeometry}
    />,
  );
  // Handles render in order se, sw, ne, nw; keep the latest render's set.
  const latest = circles.list.slice(-4);
  return { se: latest[0], nw: latest[3] };
}

function resize(handle: () => Handlers, event: unknown) {
  act(() => handle().onDragMove(event));
  act(() => handle().onDragEnd({}));
}

afterEach(cleanup);

describe("BookmarkItem resize in world space (TASK-069)", () => {
  it("resizes 'se' from the world pointer under zoom 2 and pan (100, 50)", () => {
    const commit = vi.fn();
    renderBookmark(commit);
    resize(
      () => circles.list.slice(-4)[0],
      stageEvent({ x: 500, y: 400 }, 2, { x: 100, y: 50 }),
    );
    // World pointer (200, 175): width 150 clamps to the 200 minimum.
    expect(commit).toHaveBeenLastCalledWith({
      positionX: 50,
      positionY: 50,
      width: 200,
      height: 125,
    });
  });

  it("resizes 'nw' from the world pointer under zoom and pan", () => {
    const commit = vi.fn();
    renderBookmark(commit);
    // World pointer (0, 0): the far corner (350, 200) stays put.
    resize(
      () => circles.list.slice(-4)[3],
      stageEvent({ x: 100, y: 50 }, 2, { x: 100, y: 50 }),
    );
    expect(commit).toHaveBeenLastCalledWith({
      positionX: 0,
      positionY: 0,
      width: 350,
      height: 200,
    });
  });

  it("matches the old result at zoom 1 and no pan", () => {
    const commit = vi.fn();
    renderBookmark(commit);
    resize(
      () => circles.list.slice(-4)[0],
      stageEvent({ x: 450, y: 300 }, 1, { x: 0, y: 0 }),
    );
    expect(commit).toHaveBeenLastCalledWith({
      positionX: 50,
      positionY: 50,
      width: 400,
      height: 250,
    });
  });
});

describe("resizeFromCorner", () => {
  const position = { x: 50, y: 50 };
  const size = { width: 300, height: 150 };
  const min = { width: 0, height: 0 };

  it("gives the plan's zoomed 'se' example without minimums", () => {
    expect(
      resizeFromCorner("se", { x: 200, y: 175 }, position, size, min),
    ).toEqual({ x: 50, y: 50, width: 150, height: 125 });
  });

  it("keeps the opposite corner for 'sw' and 'ne'", () => {
    expect(
      resizeFromCorner("sw", { x: 100, y: 300 }, position, size, min),
    ).toEqual({ x: 100, y: 50, width: 250, height: 250 });
    expect(
      resizeFromCorner("ne", { x: 400, y: 100 }, position, size, min),
    ).toEqual({ x: 50, y: 100, width: 350, height: 100 });
  });

  it("clamps to the minimum size", () => {
    expect(
      resizeFromCorner("nw", { x: 340, y: 190 }, position, size, {
        width: 200,
        height: 80,
      }),
    ).toEqual({ x: 150, y: 120, width: 200, height: 80 });
  });
});
