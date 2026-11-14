/**
 * IMP-142: the in-place note editor sits exactly over the note the stage
 * draws at `world * zoom + position`.
 */
import { describe, expect, it } from "vitest";
import { noteScreenRect } from "@/features/canvas/lib/note-screen-rect";

const note = { positionX: 100, positionY: 40, width: 200, height: 160 };

describe("noteScreenRect", () => {
  it("places the note at its world position at zoom 1", () => {
    expect(noteScreenRect(note, { x: 0, y: 0 }, 1)).toEqual({
      left: 100,
      top: 40,
      width: 200,
      height: 160,
    });
  });

  it("scales position and size at zoom 0.5 on a panned board", () => {
    expect(noteScreenRect(note, { x: -30, y: 25 }, 0.5)).toEqual({
      left: 20,
      top: 45,
      width: 100,
      height: 80,
    });
  });

  it("scales position and size at zoom 2 on a panned board", () => {
    expect(noteScreenRect(note, { x: 15, y: -300 }, 2)).toEqual({
      left: 215,
      top: -220,
      width: 400,
      height: 320,
    });
  });
});
