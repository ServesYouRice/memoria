import { describe, expect, it } from "vitest";
import { viewportCenterWorld } from "@/features/canvas/components/viewport-center";

describe("viewportCenterWorld", () => {
  const position = { x: -200, y: 100 };
  const stageSize = { width: 1000, height: 600 };

  it.each([
    [0.5, { x: 1400, y: 400 }],
    [1, { x: 700, y: 200 }],
    [2, { x: 350, y: 100 }],
  ])("maps the viewport centre to world space at zoom %s", (zoom, expected) => {
    const center = viewportCenterWorld(position, stageSize, zoom);
    expect(center).toEqual(expected);
    // Rendering the world point (world * zoom + position) lands at the
    // screen centre.
    expect(center.x * zoom + position.x).toBe(stageSize.width / 2);
    expect(center.y * zoom + position.y).toBe(stageSize.height / 2);
  });
});
