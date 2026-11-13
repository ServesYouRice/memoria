import { describe, expect, it } from "vitest";
import { ItemType, type CanvasItem } from "@/types/canvas";
import {
  arrowEnds,
  attachableItemAt,
  boxExit,
  drawnArrow,
  linksOf,
  moveArrowEnd,
} from "@/features/canvas/lib/arrow-attachment";

function item(
  id: string,
  x: number,
  overrides: Partial<CanvasItem> = {},
): CanvasItem {
  return {
    id,
    canvasId: "c1",
    type: ItemType.NOTE,
    positionX: x,
    positionY: 0,
    width: 100,
    height: 100,
    zIndex: 5,
    version: 1,
    content: { text: id },
    tags: [],
    createdAt: "",
    updatedAt: "",
    ...overrides,
  } as CanvasItem;
}

const a = item("a", 0);
const b = item("b", 300);
const c = item("c", 600);

describe("arrow attachment (IMP-095)", () => {
  it("leaves an item box on its edge, towards the target", () => {
    expect(boxExit(a, { x: 350, y: 50 })).toEqual({ x: 100, y: 50 });
    expect(boxExit(a, { x: 50, y: -200 })).toEqual({ x: 50, y: 0 });
    expect(boxExit(a, { x: 60, y: 60 })).toEqual({ x: 50, y: 50 });
  });

  it("hits the topmost item, never arrows or strokes, and frames last", () => {
    const frame = item("f", 0, {
      type: ItemType.FRAME,
      width: 1000,
      zIndex: 1,
    });
    const arrow = item("x", 0, { type: ItemType.ARROW, zIndex: 50 });
    const top = item("t", 0, { zIndex: 9 });
    expect(attachableItemAt([frame, a, top, arrow], { x: 10, y: 10 })?.id).toBe(
      "t",
    );
    expect(attachableItemAt([frame, a], { x: 900, y: 10 })?.id).toBe("f");
    expect(attachableItemAt([a], { x: 150, y: 10 })).toBeNull();
  });

  it("a drawn arrow attaches both ends and sits under the items", () => {
    const drawn = drawnArrow({ x: 50, y: 50 }, { x: 350, y: 50 }, [a, b]);
    expect(drawn.content).toEqual({ startItemId: "a", endItemId: "b" });
    expect(drawn.zIndex).toBe(4);
    // Edge to edge.
    expect(drawn.positionX).toBe(100);
    expect(drawn.width).toBe(200);

    const free = drawnArrow({ x: 10, y: 10 }, { x: 60, y: 60 }, [a]);
    expect(free.content).toEqual({});
    expect(free.zIndex).toBeUndefined();
  });

  it("follows its items when they move", () => {
    const drawn = drawnArrow({ x: 50, y: 50 }, { x: 350, y: 50 }, [a, b]);
    const arrow = item("arrow", drawn.positionX, {
      type: ItemType.ARROW,
      positionY: drawn.positionY,
      content: {
        ...drawn.content,
        startPoint: drawn.startPoint,
        endPoint: drawn.endPoint,
      },
    });
    const moved = { ...b, positionY: 400 };
    const ends = arrowEnds(arrow, new Map([a, moved].map((i) => [i.id, i])));
    expect(ends.start.y).toBeGreaterThan(50);
    expect(ends.end).toEqual(boxExit(moved, { x: 50, y: 50 }));
  });

  it("re-attaches an end dropped on another item and frees one dropped on empty canvas", () => {
    const drawn = drawnArrow({ x: 50, y: 50 }, { x: 350, y: 50 }, [a, b]);
    const arrow = item("arrow", drawn.positionX, {
      type: ItemType.ARROW,
      content: {
        ...drawn.content,
        label: "then",
        startPoint: drawn.startPoint,
        endPoint: drawn.endPoint,
      },
    });
    const all = [a, b, c, arrow];
    const reattached = moveArrowEnd(arrow, "end", { x: 650, y: 50 }, all);
    expect(reattached.content).toMatchObject({
      startItemId: "a",
      endItemId: "c",
      label: "then",
    });
    const freed = moveArrowEnd(arrow, "end", { x: 300, y: 900 }, all);
    expect(freed.content.endItemId).toBeUndefined();
    expect(freed.positionY + freed.content.endPoint!.y).toBe(900);
    // Never both ends on one item.
    const same = moveArrowEnd(arrow, "end", { x: 20, y: 20 }, all);
    expect(same.content.endItemId).toBeUndefined();
  });

  it("lists links both ways, with labels", () => {
    const link = item("l", 0, {
      type: ItemType.ARROW,
      content: { startItemId: "a", endItemId: "b", label: "then" },
    });
    const half = item("h", 0, {
      type: ItemType.ARROW,
      content: { startItemId: "a" },
    });
    expect(linksOf("a", [a, b, link, half])).toEqual([
      { arrowId: "l", direction: "to", item: b, label: "then" },
    ]);
    expect(linksOf("b", [a, b, link])[0]).toMatchObject({
      direction: "from",
      item: a,
    });
  });
});
