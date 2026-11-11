// @vitest-environment happy-dom
import React, { useState } from "react";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useObservedStageSize } from "@/features/canvas/components/use-observed-stage-size";

const observers: Array<{
  callback: ResizeObserverCallback;
  targets: Element[];
  disconnected: boolean;
}> = [];

class FakeResizeObserver {
  record: (typeof observers)[number];
  constructor(callback: ResizeObserverCallback) {
    this.record = { callback, targets: [], disconnected: false };
    observers.push(this.record);
  }
  observe(target: Element) {
    this.record.targets.push(target);
  }
  unobserve() {}
  disconnect() {
    this.record.disconnected = true;
  }
}

const sizes = new WeakMap<Element, { width: number; height: number }>();

function Board() {
  const [manual, setManual] = useState(true);
  const { ref, size } = useObservedStageSize();
  return (
    <div>
      <button onClick={() => setManual((value) => !value)}>toggle</button>
      <output>{`${size.width}x${size.height}`}</output>
      {manual ? (
        <div data-testid="stage" ref={ref} />
      ) : (
        <section>organizer</section>
      )}
    </div>
  );
}

beforeEach(() => {
  observers.length = 0;
  vi.stubGlobal("ResizeObserver", FakeResizeObserver);
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(
    function (this: HTMLElement) {
      const size = sizes.get(this) ?? { width: 640, height: 480 };
      return {
        ...size,
        x: 0,
        y: 0,
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
      } as DOMRect;
    },
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function resizeLive(target: Element, width: number, height: number) {
  sizes.set(target, { width, height });
  for (const observer of observers) {
    if (!observer.disconnected && observer.targets.includes(target)) {
      act(() => observer.callback([], observer as unknown as ResizeObserver));
    }
  }
}

describe("stage size observation", () => {
  it("follows the container mounted after returning from organizer view", () => {
    render(<Board />);
    expect(screen.getByRole("status").textContent).toBe("640x480");

    fireEvent.click(screen.getByText("toggle")); // organizer
    fireEvent.click(screen.getByText("toggle")); // manual again
    const stage = screen.getByTestId("stage");
    resizeLive(stage, 900.7, 300.2);
    expect(screen.getByRole("status").textContent).toBe("900x300");

    sizes.set(stage, { width: 0, height: 0 });
    resizeLive(stage, 0, 0);
    expect(screen.getByRole("status").textContent).toBe("1x1");
  });
});
