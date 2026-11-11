import { describe, expect, it } from "vitest";
import {
  describeItemDetail,
  describeItemHeading,
} from "@/features/canvas/components/CanvasItemListView";
import { canvasItemSearchText } from "@/features/canvas/search";
import { ItemType, type CanvasItem } from "@/types/canvas";

function note(content: Record<string, unknown>): CanvasItem {
  return {
    id: "note-1",
    canvasId: "canvas-1",
    type: ItemType.NOTE,
    x: 0,
    y: 0,
    width: 200,
    height: 120,
    zIndex: 0,
    tags: [],
    content,
  } as unknown as CanvasItem;
}

describe("note plain text consumers (VAL-264)", () => {
  it.each(["<b>literal</b>", "Tom &amp; Jerry"])(
    "keeps literal plainText %s verbatim",
    (plainText) => {
      const item = note({ formatVersion: 1, plainText, text: "<p>x</p>" });
      expect(describeItemHeading(item)).toBe(plainText);
      expect(describeItemDetail(item, new Map())).toBe(plainText);
      expect(canvasItemSearchText(item)).toContain(plainText.toLowerCase());
    },
  );

  it("does not show a note made of a literal tag as empty", () => {
    const item = note({ formatVersion: 1, plainText: "<br>", text: "" });
    expect(describeItemHeading(item)).toBe("<br>");
  });

  it("strips HTML only when falling back to the text field", () => {
    const item = note({ text: "<p>Hello <strong>world</strong></p>" });
    expect(describeItemHeading(item)).toBe("Hello world");
    expect(describeItemDetail(item, new Map())).toBe("Hello world");
    expect(canvasItemSearchText(item)).toContain("hello world");
  });
});
