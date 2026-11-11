// @vitest-environment happy-dom

import React from "react";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const pdf = vi.hoisted(() => ({
  addImage: vi.fn(),
  save: vi.fn(),
}));
vi.mock("jspdf", () => ({
  jsPDF: class {
    internal = { pageSize: { getWidth: () => 297, getHeight: () => 210 } };
    getImageProperties() {
      return { width: 200, height: 100 };
    }
    addImage = pdf.addImage;
    save = pdf.save;
  },
}));
vi.mock("react-konva", () => ({
  Layer: ({ children, ...props }: { children?: React.ReactNode }) =>
    React.createElement(
      "div",
      { "data-konva": "Layer", "data-props": JSON.stringify(props) },
      children,
    ),
  Line: () => null,
}));

import * as exportUtils from "@/lib/export/export-utils";
import { ExportDialog } from "@/features/canvas/components/ExportDialog";
import { GridOverlay } from "@/features/canvas/components/GridOverlay";
import type { CanvasItem } from "@/types/canvas";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  pdf.addImage.mockReset();
  pdf.save.mockReset();
});

function item(id: string, x: number, y: number, width = 100, height = 50) {
  return {
    id,
    positionX: x,
    positionY: y,
    width,
    height,
  } as unknown as CanvasItem;
}

/** A Konva stage stand-in: panned to (300, -40) at zoom 2. */
function stubStage() {
  const state = { x: 300, y: -40, scaleX: 2, scaleY: 2 };
  const seen: Array<Record<string, unknown>> = [];
  const grid = { visible: vi.fn(() => true), hide: vi.fn(), show: vi.fn() };
  const hiddenAlready = {
    visible: vi.fn(() => false),
    hide: vi.fn(),
    show: vi.fn(),
  };
  const stage = {
    x: () => state.x,
    y: () => state.y,
    scaleX: () => state.scaleX,
    scaleY: () => state.scaleY,
    position: (value: { x: number; y: number }) => {
      state.x = value.x;
      state.y = value.y;
    },
    scale: (value: { x: number; y: number }) => {
      state.scaleX = value.x;
      state.scaleY = value.y;
    },
    find: vi.fn(() => [grid, hiddenAlready]),
    batchDraw: vi.fn(),
    toDataURL: vi.fn((options: Record<string, unknown>) => {
      seen.push({ ...options, transform: { ...state } });
      if (options.fail) throw new Error("boom");
      return "data:image/png;base64,AAAA";
    }),
  };
  return { stage, state, seen, grid, hiddenAlready };
}

describe("computeItemsBounds", () => {
  it("covers every item with padding", () => {
    expect(
      exportUtils.computeItemsBounds(
        [item("a", -500, 20), item("b", 1000, 900, 200, 100)],
        40,
      ),
    ).toEqual({ x: -540, y: -20, width: 1780, height: 1060 });
    expect(exportUtils.computeItemsBounds([], 40)).toBeNull();
  });
});

describe("captureStageRegion", () => {
  it("captures the region untransformed without excluded nodes, then restores", () => {
    const { stage, state, seen, grid, hiddenAlready } = stubStage();
    const url = exportUtils.captureStageRegion(
      stage as never,
      { x: -540, y: -20, width: 1780, height: 1060 },
      { pixelRatio: 2, exclude: "export-exclude" },
    );
    expect(url).toBe("data:image/png;base64,AAAA");
    expect(stage.find).toHaveBeenCalledWith(".export-exclude");
    expect(seen[0]).toEqual({
      x: -540,
      y: -20,
      width: 1780,
      height: 1060,
      pixelRatio: 2,
      transform: { x: 0, y: 0, scaleX: 1, scaleY: 1 },
    });
    expect(grid.hide).toHaveBeenCalledTimes(1);
    expect(grid.show).toHaveBeenCalledTimes(1);
    expect(hiddenAlready.show).not.toHaveBeenCalled();
    expect(state).toEqual({ x: 300, y: -40, scaleX: 2, scaleY: 2 });
  });

  it("restores the view when the capture throws", () => {
    const { stage, state, grid } = stubStage();
    stage.toDataURL.mockImplementation(() => {
      throw new Error("tainted");
    });
    expect(() =>
      exportUtils.captureStageRegion(
        stage as never,
        { x: 0, y: 0, width: 10, height: 10 },
        { pixelRatio: 2, exclude: "export-exclude" },
      ),
    ).toThrow("tainted");
    expect(state).toEqual({ x: 300, y: -40, scaleX: 2, scaleY: 2 });
    expect(grid.show).toHaveBeenCalledTimes(1);
  });

  it("lowers the pixel ratio for huge boards", () => {
    const { stage, seen } = stubStage();
    exportUtils.captureStageRegion(
      stage as never,
      { x: 0, y: 0, width: 16384, height: 1000 },
      { pixelRatio: 2, exclude: "export-exclude" },
    );
    expect(seen[0]!.pixelRatio).toBe(0.5);
  });
});

describe("whole-board capture", () => {
  it("captures the bounding box of all items and restores the pan and zoom", () => {
    const { stage, state, seen } = stubStage();
    const bounds = exportUtils.computeItemsBounds(
      [item("a", -500, -200, 100, 100), item("b", 900, 700, 200, 50)],
      40,
    )!;
    exportUtils.captureStageRegion(stage as never, bounds, {
      pixelRatio: 2,
      exclude: "export-exclude",
    });
    expect(seen[0]).toMatchObject({
      x: -540,
      y: -240,
      width: 1680,
      height: 1030,
      transform: { x: 0, y: 0, scaleX: 1, scaleY: 1 },
    });
    expect(state).toMatchObject({ x: 300, scaleX: 2, scaleY: 2 });
  });
});

describe("exportToPDF", () => {
  it("embeds the given capture", async () => {
    await exportUtils.exportToPDF("board", "data:image/png;base64,BBBB");
    expect(pdf.addImage).toHaveBeenCalledWith(
      "data:image/png;base64,BBBB",
      "PNG",
      0,
      30.75,
      297,
      148.5,
    );
    expect(pdf.save).toHaveBeenCalledWith("board.pdf");
  });
});

describe("GridOverlay", () => {
  it("is excluded from raster exports", () => {
    const { container } = render(
      <GridOverlay width={100} height={100} gridSize={20} visible />,
    );
    const layer = container.querySelector('[data-konva="Layer"]')!;
    expect(JSON.parse(layer.getAttribute("data-props")!)).toMatchObject({
      name: "export-exclude",
    });
  });
});

describe("ExportDialog PNG export", () => {
  it("captures every board item, not just the viewport", async () => {
    const { stage, seen } = stubStage();
    const restore = vi.fn();
    const prepare = vi.fn(async () => ({
      items: [item("a", -500, 20), item("off-screen", 5000, 3000)],
      restore,
    }));
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(
      () => undefined,
    );
    render(
      <exportUtils.BoardExportCaptureContext.Provider
        value={{ current: { prepare } }}
      >
        <ExportDialog
          open
          onClose={vi.fn()}
          canvasId="c1"
          canvasName="Board"
          items={[item("a", -500, 20)]}
          stageRef={{ current: stage }}
        />
      </exportUtils.BoardExportCaptureContext.Provider>,
    );
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /^export$/i }));
    });

    expect(prepare).toHaveBeenCalledTimes(1);
    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({
      x: -540,
      y: -20,
      width: 5680,
      height: 3110,
      transform: { x: 0, y: 0, scaleX: 1, scaleY: 1 },
    });
    expect(restore).toHaveBeenCalledTimes(1);
  });
});

describe("ExportDialog without a board capture", () => {
  it("still exports the items' region with the view neutralized", async () => {
    const { stage, seen, state } = stubStage();
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(
      () => undefined,
    );
    render(
      <ExportDialog
        open
        onClose={vi.fn()}
        canvasId="c1"
        canvasName="Board"
        items={[item("a", 0, 0), item("b", 900, 400)]}
        stageRef={{ current: stage }}
      />,
    );
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /^export$/i }));
    });
    expect(seen[0]).toMatchObject({
      x: -40,
      y: -40,
      width: 1080,
      height: 530,
      transform: { x: 0, y: 0, scaleX: 1, scaleY: 1 },
    });
    expect(state).toEqual({ x: 300, y: -40, scaleX: 2, scaleY: 2 });
  });
});

describe("ExportDialog on an empty board", () => {
  it("reports that there is nothing to export instead of closing silently", async () => {
    const { stage, seen } = stubStage();
    const onClose = vi.fn();
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    render(
      <ExportDialog
        open
        onClose={onClose}
        canvasId="c1"
        canvasName="Board"
        items={[]}
        stageRef={{ current: stage }}
      />,
    );
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /^export$/i }));
    });
    expect(seen).toHaveLength(0);
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByText(/no items to export/i)).toBeTruthy();
  });
});
