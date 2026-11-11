// @vitest-environment happy-dom
import React from "react";
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ARCanvasLayer } from "@/features/canvas/components/ARCanvasLayer";

function fakeStream() {
  const tracks = [{ stop: vi.fn() }, { stop: vi.fn() }];
  return {
    tracks,
    stream: { getTracks: () => tracks } as unknown as MediaStream,
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

describe("ARCanvasLayer camera lifecycle", () => {
  let getUserMedia: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    vi.stubEnv("NEXT_PUBLIC_ENABLE_AR_CANVAS", "true");
    getUserMedia = vi.fn();
    // happy-dom type-checks srcObject against its own MediaStream; a plain
    // accessor lets the test hand the element a fake stream.
    const sources = new WeakMap<object, unknown>();
    Object.defineProperty(HTMLMediaElement.prototype, "srcObject", {
      configurable: true,
      get() {
        return sources.get(this) ?? null;
      },
      set(value: unknown) {
        sources.set(this, value);
      },
    });
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: { getUserMedia },
    });
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllEnvs();
  });

  it("stops a stream that resolves after the layer unmounted", async () => {
    const pending = deferred<MediaStream>();
    getUserMedia.mockReturnValue(pending.promise);
    const { unmount } = render(
      <ARCanvasLayer open onClose={() => {}} items={[]} />,
    );
    expect(getUserMedia).toHaveBeenCalledTimes(1);
    unmount();
    const { stream, tracks } = fakeStream();
    await act(async () => {
      pending.resolve(stream);
      await pending.promise;
    });
    for (const track of tracks) expect(track.stop).toHaveBeenCalled();
  });

  it("keeps the camera feed on the video element across re-renders", async () => {
    const { stream } = fakeStream();
    getUserMedia.mockResolvedValue(stream);
    const view = render(<ARCanvasLayer open onClose={() => {}} items={[]} />);
    await act(async () => {
      await Promise.resolve();
    });
    const video = () => document.querySelector("video") as HTMLVideoElement;
    expect(video().srcObject).toBe(stream);

    // A parent re-render with a new items array and a local state toggle.
    view.rerender(<ARCanvasLayer open onClose={() => {}} items={[]} />);
    const toggle = document
      .querySelector('[data-testid="VisibilityIcon"]')
      ?.closest("button");
    expect(toggle).toBeTruthy();
    fireEvent.click(toggle!);
    await act(async () => {
      await Promise.resolve();
    });
    expect(video().srcObject).toBe(stream);
    expect(getUserMedia).toHaveBeenCalledTimes(1);
  });
});
