// @vitest-environment happy-dom

import type React from "react";
import type Konva from "konva";
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import {
  animateItemFlight,
  computePanReleaseVelocity,
  easeOutQuint,
  isDiscreteWheelEvent,
  isRecentlyCreatedItem,
  tweenKonvaNode,
  zoomInvariantHandleMetrics,
} from "@/features/canvas/lib/canvas-motion";
import { useCameraTween } from "@/features/canvas/hooks/use-camera-tween";
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

  it("animates choreographed item flight unless reduced motion is active", () => {
    stubReducedMotion(false);
    const to = vi.fn();
    const setAttrs = vi.fn();
    animateItemFlight(
      { to, setAttrs } as unknown as Konva.Node,
      { x: 10, y: 20 },
      { x: 200, y: 300 },
    );
    expect(setAttrs).toHaveBeenCalledWith({ x: 10, y: 20 });
    expect(to).toHaveBeenCalledWith(
      expect.objectContaining({ x: 200, y: 300 }),
    );

    vi.clearAllMocks();
    stubReducedMotion(true);
    animateItemFlight(
      { to, setAttrs } as unknown as Konva.Node,
      { x: 10, y: 20 },
      { x: 200, y: 300 },
    );
    expect(to).not.toHaveBeenCalled();
  });

  it("identifies recently created items for spawn entrance", () => {
    expect(isRecentlyCreatedItem(new Date())).toBe(true);
    expect(isRecentlyCreatedItem(new Date(Date.now() - 10_000))).toBe(false);
    expect(isRecentlyCreatedItem(new Date(0))).toBe(false);
    expect(isRecentlyCreatedItem(null)).toBe(false);
  });

  it("computes zoom-invariant handle metrics with sensible clamps", () => {
    expect(zoomInvariantHandleMetrics(1)).toEqual({
      radius: 7,
      strokeWidth: 2,
    });
    expect(zoomInvariantHandleMetrics(0.5)).toEqual({
      radius: 14,
      strokeWidth: 4,
    });
    expect(zoomInvariantHandleMetrics(0.1)).toEqual({
      radius: 36,
      strokeWidth: 8,
    });
    expect(zoomInvariantHandleMetrics(5)).toEqual({
      radius: 2,
      strokeWidth: 0.75,
    });
  });

  it("computes pan release velocity and zeros out when paused", () => {
    const samples = [
      { x: 0, y: 0, t: 100 },
      { x: 40, y: 20, t: 120 },
      { x: 80, y: 40, t: 140 },
    ];
    const v = computePanReleaseVelocity(samples, 150);
    expect(v.vx).toBeCloseTo(2, 1);
    expect(v.vy).toBeCloseTo(1, 1);

    // Paused for >55ms before release -> no inertial drift.
    expect(computePanReleaseVelocity(samples, 250)).toEqual({ vx: 0, vy: 0 });
  });

  it("distinguishes discrete mouse wheel ticks from trackpad pinch", () => {
    expect(
      isDiscreteWheelEvent({
        deltaMode: 0,
        deltaX: 0,
        deltaY: 120,
        ctrlKey: false,
      }),
    ).toBe(true);
    expect(
      isDiscreteWheelEvent({
        deltaMode: 1,
        deltaX: 0,
        deltaY: 3,
        ctrlKey: false,
      }),
    ).toBe(true);
    expect(
      isDiscreteWheelEvent({
        deltaMode: 0,
        deltaX: 0,
        deltaY: -4.5,
        ctrlKey: true,
      }),
    ).toBe(false);
  });
});

describe("useCameraTween pan inertia and wheel micro-damping", () => {
  it("runs inertial pan glide in rAF and cancels immediately on pointerdown", () => {
    stubReducedMotion(false);
    let rafId = 0;
    const rafCallbacks = new Map<number, FrameRequestCallback>();
    vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
      const id = ++rafId;
      rafCallbacks.set(id, cb);
      return id;
    });
    vi.stubGlobal("cancelAnimationFrame", (id: number) => {
      rafCallbacks.delete(id);
    });

    let stageX = 100;
    let stageY = 50;
    const stage = {
      x: () => stageX,
      y: () => stageY,
      scaleX: () => 1,
      position: ({ x, y }: { x: number; y: number }) => {
        stageX = x;
        stageY = y;
      },
      scale: vi.fn(),
      batchDraw: vi.fn(),
    } as unknown as Konva.Stage;

    const onCommit = vi.fn();
    const { result } = renderHook(() =>
      useCameraTween({
        stageRef: { current: stage },
        getCurrent: () => ({ x: 100, y: 50, zoom: 1 }),
        onCommit,
      }),
    );

    act(() => {
      result.current.glidePan({ x: 100, y: 50, vx: 1.5, vy: 0 });
    });
    expect(rafCallbacks.size).toBe(1);

    const firstCb = Array.from(rafCallbacks.values())[0]!;
    rafCallbacks.clear();
    act(() => {
      firstCb(performance.now() + 16);
    });
    expect(stageX).toBeGreaterThan(100);

    // Cancel on pointerdown commits the live stage position immediately.
    act(() => {
      result.current.cancel(true);
    });
    expect(rafCallbacks.size).toBe(0);
    expect(onCommit).toHaveBeenCalledWith({
      x: stageX,
      y: stageY,
      zoom: 1,
    });
  });

  it("skips pan glide and wheel micro-damping under prefers-reduced-motion", () => {
    stubReducedMotion(true);
    const stage = {
      x: () => 0,
      y: () => 0,
      scaleX: () => 1,
      position: vi.fn(),
      scale: vi.fn(),
      batchDraw: vi.fn(),
    } as unknown as Konva.Stage;
    const onCommit = vi.fn();

    const { result } = renderHook(() =>
      useCameraTween({
        stageRef: { current: stage },
        getCurrent: () => ({ x: 0, y: 0, zoom: 1 }),
        onCommit,
      }),
    );

    act(() => {
      result.current.glidePan({ x: 50, y: 60, vx: 2, vy: 1 });
    });
    expect(onCommit).toHaveBeenCalledWith({ x: 50, y: 60, zoom: 1 });

    act(() => {
      result.current.wheelZoomBy({ factor: 1.1, pointerX: 100, pointerY: 100 });
    });
    expect(onCommit).toHaveBeenLastCalledWith({
      x: 100 - 100 * 1.1,
      y: 100 - 100 * 1.1,
      zoom: 1.1,
    });
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
