import { describe, expect, it } from "vitest";
import type React from "react";
import { DotOverlay, GridOverlay, snapToGrid } from "../GridOverlay";

type LineProps = { points: number[]; strokeWidth: number };

function lines(props: Parameters<typeof GridOverlay>[0]) {
  const layer = GridOverlay(props) as React.ReactElement<{
    children: Array<React.ReactElement<LineProps>>;
  }>;
  const all = layer.props.children.map((line) => line.props);
  const vertical = all.filter((p) => p.points[0] === p.points[2]);
  const horizontal = all.filter((p) => p.points[1] === p.points[3]);
  return {
    all,
    xs: vertical.map((p) => p.points[0]),
    ys: horizontal.map((p) => p.points[1]),
  };
}

describe("GridOverlay", () => {
  it("covers the visible world region after panning (offset is the world origin)", () => {
    // CanvasBoard passes -position / zoom; position.x = -1000 at zoom 1.
    const { xs } = lines({
      width: 800,
      height: 600,
      gridSize: 20,
      visible: true,
      zoom: 1,
      offset: { x: 1000, y: 0 },
    });
    expect(Math.min(...xs)).toBeLessThanOrEqual(1000);
    expect(Math.max(...xs)).toBeGreaterThanOrEqual(1800);
    for (const x of xs) {
      expect(x).toBeGreaterThanOrEqual(1000 - 20);
      expect(x).toBeLessThanOrEqual(1800 + 20);
    }
  });

  it("covers the visible region when zoomed", () => {
    const { xs } = lines({
      width: 800,
      height: 600,
      gridSize: 20,
      visible: true,
      zoom: 2,
      offset: { x: 500, y: 0 },
    });
    expect(Math.min(...xs)).toBeLessThanOrEqual(500);
    expect(Math.max(...xs)).toBeGreaterThanOrEqual(900);
    for (const x of xs) {
      expect(x).toBeGreaterThanOrEqual(500 - 20);
      expect(x).toBeLessThanOrEqual(900 + 20);
    }
  });

  it("bounds the line count at low zoom with a step that is a multiple of gridSize", () => {
    const low = lines({
      width: 1920,
      height: 1080,
      gridSize: 20,
      visible: true,
      zoom: 0.1,
    });
    expect(low.all.length).toBeLessThanOrEqual(400);
    const step = low.xs[1] - low.xs[0];
    expect(step % 20).toBe(0);
    expect(low.xs.every((x) => snapToGrid(x, 20) === x)).toBe(true);
    expect(low.all[0].strokeWidth).toBeCloseTo(10);

    const normal = lines({
      width: 1920,
      height: 1080,
      gridSize: 20,
      visible: true,
      zoom: 1,
    });
    expect(normal.xs[1] - normal.xs[0]).toBe(20);
  });

  it("renders nothing when hidden", () => {
    expect(
      GridOverlay({ width: 10, height: 10, gridSize: 20, visible: false }),
    ).toBeNull();
  });
});

describe("DotOverlay (IMP-085)", () => {
  type ShapeProps = {
    sceneFunc: (context: unknown, shape: unknown) => void;
  };
  function dots(props: Parameters<typeof DotOverlay>[0]) {
    const layer = DotOverlay(props) as React.ReactElement<{
      children: React.ReactElement<ShapeProps>;
    }> | null;
    if (!layer) return null;
    const arcs: Array<[number, number]> = [];
    const context = {
      beginPath() {},
      moveTo() {},
      arc(x: number, y: number) {
        arcs.push([x, y]);
      },
      fillShape() {},
    };
    layer.props.children.props.sceneFunc(context, {});
    return arcs;
  }

  it("draws dots on the snap positions across the view in one shape", () => {
    const arcs = dots({
      width: 400,
      height: 200,
      gridSize: 20,
      visible: true,
      zoom: 1,
      offset: { x: 100, y: 0 },
    })!;
    expect(arcs.length).toBeGreaterThan(100);
    for (const [x, y] of arcs) {
      expect(x % 20).toBe(0);
      expect(y % 20).toBe(0);
    }
    expect(Math.min(...arcs.map(([x]) => x))).toBeLessThanOrEqual(100);
    expect(Math.max(...arcs.map(([x]) => x))).toBeGreaterThanOrEqual(500);
  });

  it("keeps the dot count bounded when zoomed far out", () => {
    const arcs = dots({
      width: 1920,
      height: 1080,
      gridSize: 20,
      visible: true,
      zoom: 0.05,
    })!;
    expect(arcs.length).toBeLessThan(12_000);
  });

  it("draws nothing when the grid lines are on", () => {
    expect(
      dots({ width: 400, height: 200, gridSize: 20, visible: false }),
    ).toBeNull();
  });
});
