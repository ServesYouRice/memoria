// @vitest-environment happy-dom
/**
 * TASK-090 — Note and Image resize: one gesture, one geometry commit, in
 * world space at any zoom or pan.
 */

import React from "react";
import { act, cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

type Handlers = Record<string, (event: KonvaEventLike) => void>;
interface KonvaEventLike {
  target: unknown;
  currentTarget?: unknown;
  cancelBubble?: boolean;
}
const nodes = vi.hoisted(() => ({
  groups: [] as Handlers[],
  circles: [] as Handlers[],
}));

vi.mock("react-konva", () => {
  const passthrough = ({ children }: { children?: React.ReactNode }) => (
    <div>{children}</div>
  );
  return {
    Group: React.forwardRef(function Group(
      props: Handlers & { children?: React.ReactNode },
      _ref,
    ) {
      nodes.groups.push(props);
      return <div>{props.children}</div>;
    }),
    Rect: passthrough,
    Text: passthrough,
    Image: passthrough,
    Circle: (props: Handlers) => {
      nodes.circles.push(props);
      return null;
    },
  };
});

vi.mock("@/lib/images/proxy-url", () => ({
  toImageProxyUrl: (url: string) => url,
}));

import { NoteItem } from "@/features/canvas/components/NoteItem";
import { ImageItem } from "@/features/canvas/components/ImageItem";
import { resizeFromCorner } from "@/features/canvas/lib/geometry-adapter";

const zoom = 2;
const pan = { x: 100, y: 50 };

/** A handle node at its group-local corner on a zoomed, panned Stage. */
function handleEvent(world: { x: number; y: number }) {
  const screen = { x: world.x * zoom + pan.x, y: world.y * zoom + pan.y };
  const stage = {
    getPointerPosition: () => screen,
    getRelativePointerPosition: () => world,
  };
  let position = { x: 300, y: 200 };
  const circle = {
    getStage: () => stage,
    x: () => position.x,
    y: () => position.y,
    position: (next?: { x: number; y: number }) => {
      if (next) position = next;
      return position;
    },
  };
  return { target: circle } as KonvaEventLike;
}

/** Konva bubbles drag events from the handle up to the item Group. */
function dispatch(name: "onDragMove" | "onDragEnd", event: KonvaEventLike) {
  const circle = nodes.circles.slice(-4)[0];
  const group = nodes.groups[nodes.groups.length - 1];
  act(() => circle[name](event));
  if (!event.cancelBubble) {
    act(() => group[name]({ ...event, currentTarget: { group: true } }));
  }
}

const baseItem = {
  canvasId: "c1",
  positionX: 50,
  positionY: 50,
  width: 300,
  height: 200,
  zIndex: 0,
  tags: [],
};

const cases = [
  [
    "NoteItem",
    NoteItem,
    { ...baseItem, id: "n1", type: "NOTE", content: { text: "Hi" } },
  ],
  [
    "ImageItem",
    ImageItem,
    {
      ...baseItem,
      id: "i1",
      type: "IMAGE",
      content: { url: "https://example.com/a.png", filename: "a.png" },
    },
  ],
] as const;

afterEach(() => {
  cleanup();
  nodes.groups = [];
  nodes.circles = [];
});

describe.each(cases)("%s resize (TASK-090)", (_name, Component, item) => {
  it("commits once, in world space, when a handle is dragged", () => {
    const commit = vi.fn();
    render(
      <Component
        item={item as never}
        isSelected
        capabilities={{ canMoveItems: true, canResizeItems: true } as never}
        onSelect={() => undefined}
        onContextMenu={() => undefined}
        onCommitGeometry={commit}
      />,
    );

    // World pointer (450, 400): the 'se' corner lands there.
    dispatch("onDragMove", handleEvent({ x: 450, y: 400 }));
    dispatch("onDragEnd", handleEvent({ x: 450, y: 400 }));

    expect(commit).toHaveBeenCalledTimes(1);
    expect(commit).toHaveBeenCalledWith({
      positionX: 50,
      positionY: 50,
      width: 400,
      height: 350,
    });
  });
});

describe.each(cases)("%s body drag", (_name, Component, item) => {
  it("still moves the item and commits its position once", () => {
    const commit = vi.fn();
    render(
      <Component
        item={item as never}
        isSelected
        capabilities={{ canMoveItems: true, canResizeItems: true } as never}
        onSelect={() => undefined}
        onContextMenu={() => undefined}
        onCommitGeometry={commit}
      />,
    );
    const groupNode = { x: () => 80, y: () => 90 };
    const event = { target: groupNode, currentTarget: groupNode };
    act(() => nodes.groups[nodes.groups.length - 1].onDragMove(event));
    act(() => nodes.groups[nodes.groups.length - 1].onDragEnd(event));
    expect(commit).toHaveBeenCalledTimes(1);
    expect(commit).toHaveBeenCalledWith({ positionX: 80, positionY: 90 });
  });
});

describe("resizeFromCorner (geometry adapter)", () => {
  it("gives the same world result for a world pointer at any zoom", () => {
    const position = { x: 50, y: 50 };
    const size = { width: 300, height: 200 };
    const min = { width: 100, height: 100 };
    expect(resizeFromCorner("nw", { x: 0, y: 0 }, position, size, min)).toEqual(
      { x: 0, y: 0, width: 350, height: 250 },
    );
    expect(
      resizeFromCorner("se", { x: 120, y: 120 }, position, size, min),
    ).toEqual({ x: 50, y: 50, width: 100, height: 100 });
  });
});
