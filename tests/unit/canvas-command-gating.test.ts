import { describe, expect, it } from "vitest";
import {
  deleteCanvasItemSchema,
  updateCanvasItemSchema,
} from "@/lib/validation/canvas-item";

describe("unsupported canvas history commands", () => {
  it("accepts ordinary versioned item mutations", () => {
    expect(updateCanvasItemSchema.parse({ version: 2, positionX: 10 })).toEqual(
      { version: 2, positionX: 10 },
    );
    expect(deleteCanvasItemSchema.parse({ version: 2 })).toEqual({
      version: 2,
    });
  });

  it.each(["undo", "redo"])(
    "rejects an advertised %s command path",
    (command) => {
      expect(
        updateCanvasItemSchema.safeParse({ version: 2, command }).success,
      ).toBe(false);
      expect(
        deleteCanvasItemSchema.safeParse({ version: 2, command }).success,
      ).toBe(false);
    },
  );
});
