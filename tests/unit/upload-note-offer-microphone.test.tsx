// @vitest-environment happy-dom

import React from "react";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const tracker = vi.hoisted(() => ({
  track: vi.fn(),
  fail: vi.fn(),
  message: null,
  clearMessage: vi.fn(),
}));
vi.mock("@/features/canvas/hooks/use-upload-notes", () => ({
  requestUploadNote: vi.fn(),
  uploadAssetIdFromUrl: () => null,
  uploadVoiceNote: vi.fn(),
  useUploadNoteOffers: () => ({ readImage: false, speechToText: true }),
  useUploadNoteTracker: () => tracker,
}));

import { UploadNoteOffer } from "@/features/canvas/components/UploadNoteOffer";

const starts: unknown[] = [];
class FakeRecorder {
  static isTypeSupported = () => true;
  mimeType = "audio/webm";
  ondataavailable: unknown = null;
  onstop: unknown = null;
  start = vi.fn(() => starts.push(this));
  stop = vi.fn();
}

let pending: Array<(stream: MediaStream) => void> = [];
const getUserMedia = vi.fn(
  () => new Promise<MediaStream>((resolve) => pending.push(resolve)),
);

function fakeStream() {
  const track = { stop: vi.fn() };
  return {
    track,
    stream: { getTracks: () => [track] } as unknown as MediaStream,
  };
}

beforeEach(() => {
  starts.length = 0;
  pending = [];
  getUserMedia.mockClear();
  vi.stubGlobal("MediaRecorder", FakeRecorder);
  Object.defineProperty(navigator, "mediaDevices", {
    configurable: true,
    value: { getUserMedia },
  });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function renderOffer() {
  return render(
    <UploadNoteOffer
      canvasId="c1"
      canEdit
      selectedItem={null}
      getViewportCenter={() => ({ x: 0, y: 0 })}
    />,
  );
}

describe("UploadNoteOffer microphone lifecycle", () => {
  it("stops the stream and records nothing if unmounted during getUserMedia", async () => {
    const view = renderOffer();
    fireEvent.click(screen.getByLabelText("Record voice note"));
    expect(getUserMedia).toHaveBeenCalledTimes(1);
    view.unmount();
    const { stream, track } = fakeStream();
    await act(async () => pending[0](stream));
    expect(starts).toHaveLength(0);
    expect(track.stop).toHaveBeenCalled();
  });

  it("ignores a second start while acquisition is pending", async () => {
    renderOffer();
    const button = screen.getByLabelText("Record voice note");
    fireEvent.click(button);
    fireEvent.click(button);
    expect(getUserMedia).toHaveBeenCalledTimes(1);
    await act(async () => pending[0](fakeStream().stream));
    expect(starts).toHaveLength(1);
  });

  it("stops the stream when the MediaRecorder cannot be created", async () => {
    vi.stubGlobal(
      "MediaRecorder",
      Object.assign(
        function Broken() {
          throw new Error("NotSupportedError");
        },
        { isTypeSupported: () => true },
      ),
    );
    renderOffer();
    fireEvent.click(screen.getByLabelText("Record voice note"));
    const { stream, track } = fakeStream();
    await act(async () => pending[0](stream));
    expect(track.stop).toHaveBeenCalled();
    expect(tracker.fail).toHaveBeenCalled();
  });
});
