import { describe, expect, it } from "vitest";
import { stageDragPosition } from "./stage-drag";

function node(x: number, y: number, stage?: unknown) {
  const self: {
    x: () => number;
    y: () => number;
    getStage: () => unknown;
  } = { x: () => x, y: () => y, getStage: () => stage ?? self };
  return self;
}

describe("stageDragPosition", () => {
  it("ignores drag events that bubbled up from a child item", () => {
    const stage = node(10, 20);
    const item = node(640, 480, stage);
    expect(stageDragPosition({ target: item })).toBeNull();
  });

  it("returns the stage position when the stage itself is dragged", () => {
    const stage = node(-120, 35);
    expect(stageDragPosition({ target: stage })).toEqual({ x: -120, y: 35 });
  });
});
