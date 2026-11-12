// @vitest-environment happy-dom
/**
 * IMP-084: the bottom add bar and the corner view tools have visible labels
 * or accessible names, and each one still does its job.
 */
import React from "react";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CanvasAddBar } from "@/features/canvas/components/CanvasAddBar";
import {
  CanvasViewControls,
  zoomedIn,
  zoomedOut,
} from "@/features/canvas/components/CanvasViewControls";
import { VIEW_MODES } from "@/features/canvas/components/CanvasHeader";
import { useCanvasStore } from "@/stores/canvasStore";

afterEach(() => {
  cleanup();
  useCanvasStore.setState({ activeTool: "select" });
});

describe("add bar", () => {
  it("shows a labelled button for each tool and item", () => {
    render(
      <CanvasAddBar
        onAddNote={vi.fn()}
        onAddLink={vi.fn()}
        onAddImage={vi.fn()}
      />,
    );
    const bar = screen.getByRole("toolbar", { name: "Add to canvas" });
    for (const label of [
      "Select",
      "Pan",
      "Note",
      "Link",
      "Image",
      "Text",
      "Shape",
      "Arrow",
      "Draw",
    ]) {
      expect(bar.textContent).toContain(label);
      expect(screen.getByRole("button", { name: label })).toBeTruthy();
    }
  });

  it("adds items and switches tools", () => {
    const onAddNote = vi.fn();
    render(
      <CanvasAddBar
        onAddNote={onAddNote}
        onAddLink={vi.fn()}
        onAddImage={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Note" }));
    expect(onAddNote).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole("button", { name: "Draw" }));
    expect(useCanvasStore.getState().activeTool).toBe("draw");
    expect(
      screen.getByRole("button", { name: "Draw" }).getAttribute("aria-pressed"),
    ).toBe("true");
  });
});

describe("view tools", () => {
  it("zooms in steps and stays inside the limits", () => {
    expect(zoomedIn(1)).toBe(1.1);
    expect(zoomedOut(1)).toBe(0.9);
    expect(zoomedIn(5)).toBe(5);
    expect(zoomedOut(0.1)).toBe(0.1);
  });

  it("names every button and reports the zoom", () => {
    const onZoomChange = vi.fn();
    const onGridToggle = vi.fn();
    render(
      <CanvasViewControls
        zoom={1}
        onZoomChange={onZoomChange}
        onFitToScreen={vi.fn()}
        gridVisible={false}
        onGridToggle={onGridToggle}
        snapEnabled={false}
      />,
    );
    expect(screen.getByRole("toolbar", { name: "View" }).textContent).toContain(
      "100%",
    );
    fireEvent.click(screen.getByRole("button", { name: "Zoom in" }));
    expect(onZoomChange).toHaveBeenCalledWith(1.1);
    fireEvent.click(screen.getByRole("button", { name: "Grid lines" }));
    expect(onGridToggle).toHaveBeenCalledOnce();
    expect(screen.getByRole("button", { name: "Fit to screen" })).toBeTruthy();
    // Viewers cannot move items, so snapping is not offered.
    expect(screen.queryByRole("button", { name: "Snap to grid" })).toBeNull();
  });
});

describe("view names", () => {
  it("uses plain names with an explanation", () => {
    expect(VIEW_MODES.manual.label).toBe("Free layout");
    expect(VIEW_MODES.organizer.label).toBe("Organised list");
    expect(VIEW_MODES.manual.tooltip).not.toBe("");
    expect(VIEW_MODES.organizer.tooltip).not.toBe("");
  });
});
