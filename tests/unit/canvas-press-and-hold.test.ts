/**
 * IMP-140: press and hold opens an item's menu on touch screens. The timing
 * logic is a pure helper, tested here with fake timers.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createPressAndHold } from "@/features/canvas/press-and-hold";

const START = { x: 100, y: 200 };

function setup() {
  const onHold = vi.fn();
  const hold = createPressAndHold<string>({ onHold });
  return { onHold, hold };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("press and hold", () => {
  it("opens after a 500 ms hold, at the finger", () => {
    const { hold, onHold } = setup();
    hold.start(START, "item-1", 1);
    vi.advanceTimersByTime(499);
    expect(onHold).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(onHold).toHaveBeenCalledTimes(1);
    expect(onHold).toHaveBeenCalledWith(START, "item-1");
    expect(hold.isHeld()).toBe(true);
  });

  it("allows a small wobble but cancels when the finger moves 20px", () => {
    const { hold, onHold } = setup();
    hold.start(START, "item-1", 1);
    hold.move({ x: 105, y: 204 });
    vi.advanceTimersByTime(500);
    expect(onHold).toHaveBeenCalledTimes(1);

    hold.start(START, "item-1", 1);
    hold.move({ x: 120, y: 200 });
    vi.advanceTimersByTime(1000);
    expect(onHold).toHaveBeenCalledTimes(1);
  });

  it("cancels when the finger is lifted at 300 ms", () => {
    const { hold, onHold } = setup();
    hold.start(START, "item-1", 1);
    vi.advanceTimersByTime(300);
    hold.cancel();
    vi.advanceTimersByTime(1000);
    expect(onHold).not.toHaveBeenCalled();
    expect(hold.isHeld()).toBe(false);
  });

  it("does not start with two fingers, and a second finger cancels", () => {
    const { hold, onHold } = setup();
    hold.start(START, "item-1", 2);
    vi.advanceTimersByTime(1000);
    expect(onHold).not.toHaveBeenCalled();

    hold.start(START, "item-1", 1);
    vi.advanceTimersByTime(200);
    hold.start(START, "item-1", 2);
    vi.advanceTimersByTime(1000);
    expect(onHold).not.toHaveBeenCalled();
  });

  it("ignores the contextmenu that follows a hold", () => {
    const { hold, onHold } = setup();
    hold.start(START, "item-1", 1);
    vi.advanceTimersByTime(500);
    expect(onHold).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(100);
    expect(hold.shouldIgnoreContextMenu()).toBe(true);
    vi.advanceTimersByTime(700);
    // Later right-clicks work again.
    expect(hold.shouldIgnoreContextMenu()).toBe(false);
  });

  it("lets a contextmenu through when the browser opened the menu first", () => {
    const { hold, onHold } = setup();
    hold.start(START, "item-1", 1);
    vi.advanceTimersByTime(480);
    expect(hold.shouldIgnoreContextMenu()).toBe(false);
    vi.advanceTimersByTime(1000);
    expect(onHold).not.toHaveBeenCalled();
  });

  it("does not hold-open a mouse right-click", () => {
    const { hold } = setup();
    expect(hold.shouldIgnoreContextMenu()).toBe(false);
  });
});
