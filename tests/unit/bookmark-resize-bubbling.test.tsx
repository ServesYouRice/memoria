// @vitest-environment happy-dom

import React from "react";
import { act, cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { resolveCanvasCapabilities, type CanvasItem } from "@/types/canvas";

type Handlers = Record<string, ((e: unknown) => void) | undefined>;
const nodes = vi.hoisted(() => ({
  group: {} as Handlers,
  circles: [] as Handlers[],
}));

vi.mock("react-konva", () => {
  const Group = (props: Handlers & { children?: React.ReactNode }) => {
    nodes.group = props;
    return <div>{props.children}</div>;
  };
  const Circle = (props: Handlers) => {
    nodes.circles.push(props);
    return null;
  };
  const Nothing = () => null;
  return { Group, Circle, Rect: Nothing, Text: Nothing, Image: Nothing };
});

import { BookmarkItem } from "@/features/canvas/components/BookmarkItem";

afterEach(cleanup);

const item = {
  id: "b1",
  canvasId: "c1",
  type: "BOOKMARK",
  positionX: 100,
  positionY: 100,
  width: 300,
  height: 150,
  zIndex: 1,
  content: { url: "https://example.com" },
  version: 1,
  updatedAt: "2026-11-11T00:00:00Z",
} as unknown as CanvasItem;

function konvaNode(x: number, y: number, pointer = { x: 0, y: 0 }) {
  const stage = {
    getPointerPosition: () => pointer,
    // Unzoomed, unpanned stage: world space equals container space (TASK-069).
    getRelativePointerPosition: () => pointer,
    container: () => ({ style: {} }),
  };
  return { x: () => x, y: () => y, getStage: () => stage };
}

/** Konva semantics: the child's handler, then the ancestor's unless cancelled. */
function bubble(
  child: (e: unknown) => void,
  parent: ((e: unknown) => void) | undefined,
  target: unknown,
  currentParent: unknown,
) {
  const event = { target, currentTarget: target, cancelBubble: false, evt: {} };
  child(event);
  if (!event.cancelBubble && parent) {
    parent({ ...event, currentTarget: currentParent });
  }
}

function setup() {
  const onCommitGeometry = vi.fn();
  nodes.circles = [];
  render(
    <BookmarkItem
      item={item}
      isSelected
      capabilities={resolveCanvasCapabilities("EDIT")}
      onSelect={vi.fn()}
      onActivate={vi.fn()}
      onContextMenu={vi.fn()}
      onCommitGeometry={onCommitGeometry}
    />,
  );
  return { onCommitGeometry };
}

describe("BookmarkItem resize handle drags", () => {
  it("commit one resize, without the Group's move handlers moving the item", () => {
    const { onCommitGeometry } = setup();
    const groupNode = konvaNode(100, 100);
    // Bottom-right handle at group-local (300,150), pointer moved to (500,300).
    const handle = konvaNode(300, 150, { x: 500, y: 300 });
    const se = () => nodes.circles[nodes.circles.length - 4];
    act(() =>
      bubble(se().onDragMove!, nodes.group.onDragMove, handle, groupNode),
    );
    act(() =>
      bubble(se().onDragEnd!, nodes.group.onDragEnd, handle, groupNode),
    );

    expect(onCommitGeometry).toHaveBeenCalledTimes(1);
    expect(onCommitGeometry).toHaveBeenCalledWith({
      positionX: 100,
      positionY: 100,
      width: 400,
      height: 200,
    });
  });

  it("still commits a body drag once, position only", () => {
    const { onCommitGeometry } = setup();
    const groupNode = konvaNode(240, 260);
    act(() =>
      nodes.group.onDragMove!({ target: groupNode, currentTarget: groupNode }),
    );
    act(() =>
      nodes.group.onDragEnd!({ target: groupNode, currentTarget: groupNode }),
    );
    expect(onCommitGeometry).toHaveBeenCalledTimes(1);
    expect(onCommitGeometry).toHaveBeenCalledWith({
      positionX: 240,
      positionY: 260,
    });
  });
});
