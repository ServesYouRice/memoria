// @vitest-environment happy-dom
import React from "react";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ create: vi.fn() }));

vi.mock("@/lib/hooks/use-canvas-items", () => ({
  useCreateCanvasItem: () => ({ mutateAsync: mocks.create }),
}));
vi.mock("@/features/canvas/hooks/use-upload-notes", () => ({
  announceUploadNote: vi.fn(),
  requestUploadNote: vi.fn(),
  uploadAssetIdFromUrl: () => null,
  useUploadNoteOffers: () => ({ readImage: false }),
}));
vi.mock("next/image", () => ({
  default: (props: { alt: string }) => <span>{props.alt}</span>,
}));

import { CreateImageDialog } from "@/features/canvas/components/CreateImageDialog";

const images: { src: string; onerror: (() => void) | null }[] = [];
let uploads = 0;

beforeEach(() => {
  uploads = 0;
  images.length = 0;
  mocks.create.mockReset();
  mocks.create.mockResolvedValue({});
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      if (init?.method === "DELETE") return new Response("{}");
      uploads += 1;
      return new Response(
        JSON.stringify({
          assetId: `asset-${uploads}`,
          url: `/api/v1/uploads/asset-${uploads}`,
          filename: `photo-${uploads}.png`,
        }),
      );
    }),
  );
  // Image loads finish only when the test says so.
  vi.stubGlobal(
    "Image",
    class {
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      src = "";
      constructor() {
        images.push(this);
      }
    },
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function pick(name: string) {
  const input = document.querySelector(
    'input[type="file"]',
  ) as HTMLInputElement;
  fireEvent.change(input, {
    target: { files: [new File(["x"], name, { type: "image/png" })] },
  });
}

describe("CreateImageDialog replacement", () => {
  it("keeps Add disabled until the replacement loads and submits the new upload", async () => {
    render(<CreateImageDialog open onClose={vi.fn()} canvasId="c1" />);
    pick("first.png");
    await waitFor(() => expect(images).toHaveLength(1));
    act(() => images[0]!.onerror?.());
    const add = () =>
      screen.getByRole("button", {
        name: "Add to Canvas",
      }) as HTMLButtonElement;
    await waitFor(() => expect(add().disabled).toBe(false));

    pick("second.png");
    await waitFor(() => expect(images).toHaveLength(2));
    // The replacement upload finished but its image has not loaded yet.
    await waitFor(() => expect(uploads).toBe(2));
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(add().disabled).toBe(true);

    act(() => images[1]!.onerror?.());
    await waitFor(() => expect(add().disabled).toBe(false));
    fireEvent.click(add());
    await waitFor(() => expect(mocks.create).toHaveBeenCalledTimes(1));
    expect(mocks.create.mock.calls[0]![0].content.url).toBe(
      "/api/v1/uploads/asset-2",
    );
  });

  it("ignores a late load from an earlier selection", async () => {
    render(<CreateImageDialog open onClose={vi.fn()} canvasId="c1" />);
    pick("first.png");
    await waitFor(() => expect(images).toHaveLength(1));
    pick("second.png");
    await waitFor(() => expect(images).toHaveLength(2));
    act(() => images[1]!.onerror?.());
    act(() => images[0]!.onerror?.());
    const add = screen.getByRole("button", {
      name: "Add to Canvas",
    }) as HTMLButtonElement;
    await waitFor(() => expect(add.disabled).toBe(false));
    fireEvent.click(add);
    await waitFor(() => expect(mocks.create).toHaveBeenCalledTimes(1));
    expect(mocks.create.mock.calls[0]![0].content.url).toBe(
      "/api/v1/uploads/asset-2",
    );
  });
});
