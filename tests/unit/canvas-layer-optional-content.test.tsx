// @vitest-environment happy-dom
/* eslint-disable react/display-name -- konva and item stubs */

import React from "react";
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

// Konva nodes become plain elements carrying their props as JSON.
vi.mock("react-konva", () => {
  const node =
    (name: string) =>
    ({ children, ...props }: { children?: React.ReactNode }) =>
      React.createElement(
        "div",
        { "data-konva": name, "data-props": JSON.stringify(props) },
        children,
      );
  return {
    Layer: node("Layer"),
    Group: node("Group"),
    Rect: node("Rect"),
    Text: node("Text"),
    Arrow: node("Arrow"),
    Line: node("Line"),
    Circle: node("Circle"),
    Ellipse: node("Ellipse"),
    Image: node("Image"),
    RegularPolygon: node("RegularPolygon"),
    Star: node("Star"),
  };
});
vi.mock("use-image", () => ({ default: () => [undefined, "loading"] }));
const stub = vi.hoisted(
  () =>
    (name: string) =>
    ({ item }: { item: { id: string } }) =>
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      require("react").createElement("div", {
        "data-item": name,
        "data-id": item.id,
      }),
);
vi.mock("@/features/canvas/components/ArrowItem", () => ({
  ArrowItem: stub("ArrowItem"),
}));
vi.mock("@/features/canvas/components/TextItem", () => ({
  TextItem: stub("TextItem"),
}));
vi.mock("@/features/canvas/components/FrameItem", () => ({
  FrameItem: stub("FrameItem"),
}));

import { CanvasItemLayer } from "@/features/canvas/components/CanvasItemLayer";
import { ReadonlyCanvasItemLayer } from "@/features/canvas/components/ReadonlyCanvasItemLayer";
import { parseCanvasItemContent } from "@/lib/validation/canvas-item";
import { type CanvasItem, ItemType } from "@/types/canvas";

const END_ID = "c" + "e".repeat(24);

const payloads: Array<[string, ItemType, Record<string, unknown>]> = [
  ["TEXT with only text", ItemType.TEXT, { text: "hi" }],
  [
    "ARROW with only endItemId and label",
    ItemType.ARROW,
    { endItemId: END_ID, label: "next" },
  ],
  ["ARROW with only stroke", ItemType.ARROW, { stroke: "#ff0000" }],
  ["empty FRAME", ItemType.FRAME, {}],
];

function itemFor(type: ItemType, content: Record<string, unknown>) {
  return {
    id: "citem",
    canvasId: "ccanvas",
    type,
    positionX: 10,
    positionY: 20,
    width: 120,
    height: 80,
    zIndex: 0,
    content,
    tags: [],
    version: 1,
    deletedAt: null,
    createdById: "cuser",
    updatedById: null,
    deletedById: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  } as unknown as CanvasItem;
}

function renderEditable(item: CanvasItem) {
  return render(
    <CanvasItemLayer
      items={[item]}
      selectedItemIds={new Set()}
      isSelecting={false}
      selectionBox={null}
      capabilities={{} as never}
      onSelectItem={vi.fn()}
      onContextMenu={vi.fn()}
      onActivateItem={vi.fn()}
      onCommitGeometry={vi.fn()}
    />,
  );
}

function propsOf(container: HTMLElement, name: string) {
  return [...container.querySelectorAll(`[data-konva="${name}"]`)].map((node) =>
    JSON.parse(node.getAttribute("data-props") ?? "{}"),
  );
}

afterEach(cleanup);

describe.each(payloads)("%s", (_name, type, content) => {
  it("passes the server schema", () => {
    expect(() => parseCanvasItemContent(type, content)).not.toThrow();
  });

  it("renders in the editable layer", () => {
    const { container } = renderEditable(itemFor(type, content));
    expect(container.querySelector("[data-item]")).not.toBeNull();
  });

  it("renders in the read-only layer", () => {
    const { container } = render(
      <ReadonlyCanvasItemLayer items={[itemFor(type, content)]} />,
    );
    expect(container.querySelectorAll("[data-konva]").length).toBeGreaterThan(
      1,
    );
  });
});

describe("read-only defaults for missing fields", () => {
  it("draws text at the default size", () => {
    const { container } = render(
      <ReadonlyCanvasItemLayer
        items={[itemFor(ItemType.TEXT, { text: "hi" })]}
      />,
    );
    expect(propsOf(container, "Text")[0]).toMatchObject({
      text: "hi",
      fontSize: 16,
    });
  });

  it("draws an arrow across the item box", () => {
    const { container } = render(
      <ReadonlyCanvasItemLayer
        items={[itemFor(ItemType.ARROW, { stroke: "#ff0000" })]}
      />,
    );
    expect(propsOf(container, "Arrow")[0]).toMatchObject({
      points: [0, 0, 120, 80],
      stroke: "#ff0000",
    });
  });

  it("titles an empty frame", () => {
    const { container } = render(
      <ReadonlyCanvasItemLayer items={[itemFor(ItemType.FRAME, {})]} />,
    );
    expect(propsOf(container, "Text")[0]).toMatchObject({ text: "Frame" });
  });
});

describe("content that fails its schema", () => {
  it("is still not rendered", () => {
    const bad: Array<[ItemType, Record<string, unknown>]> = [
      [ItemType.TEXT, { fontSize: 12 }],
      [ItemType.ARROW, { startPoint: "nowhere" }],
    ];
    for (const [type, content] of bad) {
      expect(() => parseCanvasItemContent(type, content)).toThrow();
      const editable = renderEditable(itemFor(type, content));
      expect(editable.container.querySelector("[data-item]")).toBeNull();
      cleanup();
      const readonly = render(
        <ReadonlyCanvasItemLayer items={[itemFor(type, content)]} />,
      );
      expect(readonly.container.querySelectorAll("[data-konva]")).toHaveLength(
        1,
      );
      cleanup();
    }
  });
});
