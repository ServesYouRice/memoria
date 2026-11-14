// @vitest-environment jsdom
import React from "react";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { CanvasAddBar } from "@/features/canvas/components/CanvasAddBar";
import { useCanvasStore } from "@/stores/canvasStore";

function mockPhone(matches: boolean) {
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches,
    media: query,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    onchange: null,
    dispatchEvent: vi.fn(),
  })) as unknown as typeof window.matchMedia;
}

const props = {
  onAddNote: vi.fn(),
  onAddLink: vi.fn(),
  onAddImage: vi.fn(),
  onAddPoll: vi.fn(),
  onAddTable: vi.fn(),
};

describe("CanvasAddBar More menu", () => {
  beforeEach(() => {
    useCanvasStore.getState().setActiveTool("select");
  });

  it("on a phone shows five tools plus More with the rest in a menu", () => {
    mockPhone(true);
    render(<CanvasAddBar {...props} />);
    expect(screen.getAllByRole("button")).toHaveLength(6);
    expect(screen.queryByRole("button", { name: "Draw" })).toBeNull();
    const more = screen.getByRole("button", { name: "More tools" });
    expect(more.getAttribute("aria-haspopup")).toBe("menu");
    fireEvent.click(more);
    const names = screen.getAllByRole("menuitem").map((i) => i.textContent);
    expect(names).toEqual(["Text", "Shape", "Arrow", "Draw", "Poll", "Table"]);
    fireEvent.click(screen.getByRole("menuitem", { name: "Draw" }));
    expect(useCanvasStore.getState().activeTool).toBe("draw");
  });

  it("marks More pressed while an overflow tool is active and runs actions", () => {
    mockPhone(true);
    useCanvasStore.getState().setActiveTool("arrow");
    render(<CanvasAddBar {...props} />);
    const more = screen.getByRole("button", { name: "More tools" });
    expect(more.getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(more);
    fireEvent.click(screen.getByRole("menuitem", { name: "Table" }));
    expect(props.onAddTable).toHaveBeenCalledTimes(1);
  });

  it("on a computer shows every tool and no More button", () => {
    mockPhone(false);
    render(<CanvasAddBar {...props} />);
    expect(screen.queryByRole("button", { name: "More tools" })).toBeNull();
    expect(screen.getByRole("button", { name: "Draw" })).toBeTruthy();
  });
});
