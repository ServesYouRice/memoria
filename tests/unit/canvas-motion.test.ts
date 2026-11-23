// @vitest-environment happy-dom

import type React from "react";
import type Konva from "konva";
import { afterEach, describe, expect, it, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import {
  easeOutQuint,
  tweenKonvaNode,
} from "@/features/canvas/lib/canvas-motion";
import { useCanvasKeyboard } from "@/features/canvas/hooks/use-canvas-keyboard";

function stubReducedMotion(matches: boolean) {
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches: matches && query.includes("prefers-reduced-motion"),
    media: query,
    onchange: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })) as unknown as typeof window.matchMedia;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("canvas motion helpers", () => {
  it("eases smoothly from 0 to 1", () => {
    expect(easeOutQuint(0)).toBe(0);
    expect(easeOutQuint(1)).toBe(1);
    expect(easeOutQuint(0.5)).toBeGreaterThan(0.9);
    expect(easeOutQuint(-0.2)).toBe(0);
    expect(easeOutQuint(1.5)).toBe(1);
  });

  it("skips Konva tweens when prefers-reduced-motion is active", () => {
    stubReducedMotion(true);
    const to = vi.fn();
    const setAttrs = vi.fn();
    const onFinish = vi.fn();

    tweenKonvaNode({ to, setAttrs } as unknown as Konva.Node, {
      scaleX: 1.02,
      duration: 0.2,
      onFinish,
    });

    expect(to).not.toHaveBeenCalled();
    expect(setAttrs).toHaveBeenCalledWith({ scaleX: 1.02 });
    expect(onFinish).toHaveBeenCalledOnce();
  });

  it("runs Konva.Node.to when motion is enabled", () => {
    stubReducedMotion(false);
    const to = vi.fn();
    const setAttrs = vi.fn();

    tweenKonvaNode({ to, setAttrs } as unknown as Konva.Node, {
      width: 120,
      duration: 0.25,
    });

    expect(to).toHaveBeenCalledWith(
      expect.objectContaining({ width: 120, duration: 0.25 }),
    );
    expect(setAttrs).not.toHaveBeenCalled();
  });
});

describe("canvas single-key tool shortcuts", () => {
  it("switches tools and triggers quick note when allowed", () => {
    const onSelectTool = vi.fn();
    const onAddNote = vi.fn();

    renderHook(() =>
      useCanvasKeyboard({
        onDelete: vi.fn(),
        onCopy: vi.fn(),
        onPaste: vi.fn(),
        onSelectAll: vi.fn(),
        onDuplicate: vi.fn(),
        onEscape: vi.fn(),
        onSelectTool,
        onAddNote,
        canEdit: true,
        isDrawing: false,
        stageRef: { current: null } as unknown as React.RefObject<Konva.Stage>,
        onChatOpen: vi.fn(),
        onReactionOpen: vi.fn(),
        selectedItemIds: new Set<string>(),
        selectedItemId: null,
        allItems: [],
        nudgeItem: vi.fn(),
      }),
    );

    window.dispatchEvent(
      new KeyboardEvent("keydown", { key: "h", bubbles: true }),
    );
    window.dispatchEvent(
      new KeyboardEvent("keydown", { key: "p", bubbles: true }),
    );
    window.dispatchEvent(
      new KeyboardEvent("keydown", { key: "n", bubbles: true }),
    );

    expect(onSelectTool).toHaveBeenNthCalledWith(1, "pan");
    expect(onSelectTool).toHaveBeenNthCalledWith(2, "draw");
    expect(onAddNote).toHaveBeenCalledOnce();
  });

  it("allows pan/select for viewers but blocks creation shortcuts", () => {
    const onSelectTool = vi.fn();
    const onAddNote = vi.fn();

    renderHook(() =>
      useCanvasKeyboard({
        onDelete: vi.fn(),
        onCopy: vi.fn(),
        onPaste: vi.fn(),
        onSelectAll: vi.fn(),
        onDuplicate: vi.fn(),
        onEscape: vi.fn(),
        onSelectTool,
        onAddNote,
        canEdit: false,
        isDrawing: false,
        stageRef: { current: null } as unknown as React.RefObject<Konva.Stage>,
        onChatOpen: vi.fn(),
        onReactionOpen: vi.fn(),
        selectedItemIds: new Set<string>(),
        selectedItemId: null,
        allItems: [],
        nudgeItem: vi.fn(),
      }),
    );

    window.dispatchEvent(
      new KeyboardEvent("keydown", { key: "h", bubbles: true }),
    );
    window.dispatchEvent(
      new KeyboardEvent("keydown", { key: "p", bubbles: true }),
    );
    window.dispatchEvent(
      new KeyboardEvent("keydown", { key: "n", bubbles: true }),
    );

    expect(onSelectTool).toHaveBeenCalledTimes(1);
    expect(onSelectTool).toHaveBeenCalledWith("pan");
    expect(onAddNote).not.toHaveBeenCalled();
  });
});
