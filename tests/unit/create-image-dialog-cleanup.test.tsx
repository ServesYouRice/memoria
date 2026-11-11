// @vitest-environment happy-dom
/**
 * Uploads abandoned in the image dialog are deleted so they stop counting
 * against the owner's quota; a committed upload is never deleted.
 */

import React from "react";
import {
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
  uploadAssetIdFromUrl: (url: string) => url.split("/").pop() ?? null,
  useUploadNoteOffers: () => ({ readImage: false }),
}));
vi.mock("next/image", () => ({
  default: (props: { alt: string }) => <span>{props.alt}</span>,
}));

import { CreateImageDialog } from "@/features/canvas/components/CreateImageDialog";

const fetchMock = vi.fn();
let uploads = 0;

function deletes() {
  return fetchMock.mock.calls
    .filter(
      ([, init]) => (init as RequestInit | undefined)?.method === "DELETE",
    )
    .map(([url]) => url as string);
}

async function pickFile(container: HTMLElement) {
  const input = container.ownerDocument.querySelector(
    'input[type="file"]',
  ) as HTMLInputElement;
  const file = new File(["x"], "photo.png", { type: "image/png" });
  fireEvent.change(input, { target: { files: [file] } });
  const expected = `asset-${uploads}`;
  await waitFor(() =>
    expect(screen.getByRole("button", { name: "Change Image" })).toBeTruthy(),
  );
  return expected;
}

describe("CreateImageDialog upload cleanup", () => {
  beforeEach(() => {
    uploads = 0;
    fetchMock.mockReset();
    mocks.create.mockReset();
    mocks.create.mockResolvedValue({});
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
      if (url === "/api/v1/upload") {
        uploads += 1;
        return new Response(
          JSON.stringify({
            assetId: `asset-${uploads}`,
            url: `/api/v1/uploads/asset-${uploads}`,
            filename: "photo.png",
          }),
          { status: 200 },
        );
      }
      if (init?.method === "DELETE") {
        return new Response("{}", { status: 403 });
      }
      return new Response("{}", { status: 404 });
    });
    vi.stubGlobal("fetch", fetchMock);
    // happy-dom never loads the preview image; fire onerror so the
    // dialog records the upload.
    vi.stubGlobal(
      "Image",
      class {
        onload: (() => void) | null = null;
        onerror: (() => void) | null = null;
        set src(_value: string) {
          queueMicrotask(() => this.onerror?.());
        }
      },
    );
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("deletes the uploaded asset when the dialog is cancelled", async () => {
    const onClose = vi.fn();
    const { container } = render(
      <CreateImageDialog open onClose={onClose} canvasId="canvas-1" />,
    );
    await pickFile(container);
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

    expect(onClose).toHaveBeenCalled();
    expect(deletes()).toEqual(["/api/v1/uploads/asset-1"]);
  });

  it("deletes the previous asset when the image is changed", async () => {
    const { container } = render(
      <CreateImageDialog open onClose={vi.fn()} canvasId="canvas-1" />,
    );
    await pickFile(container);
    const input = container.ownerDocument.querySelector(
      'input[type="file"]',
    ) as HTMLInputElement;
    fireEvent.change(input, {
      target: { files: [new File(["y"], "second.png", { type: "image/png" })] },
    });
    await waitFor(() => expect(uploads).toBe(2));
    await waitFor(() => expect(deletes()).toEqual(["/api/v1/uploads/asset-1"]));
  });

  it("never deletes an asset that was added to the canvas", async () => {
    const onClose = vi.fn();
    const { container } = render(
      <CreateImageDialog open onClose={onClose} canvasId="canvas-1" />,
    );
    await pickFile(container);
    fireEvent.click(screen.getByRole("button", { name: "Add to Canvas" }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());

    expect(mocks.create).toHaveBeenCalledTimes(1);
    expect(deletes()).toEqual([]);
  });

  it("closes even when the delete request fails", async () => {
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
      if (init?.method === "DELETE") throw new TypeError("network");
      uploads += 1;
      return new Response(
        JSON.stringify({
          assetId: `asset-${uploads}`,
          url: `/api/v1/uploads/asset-${uploads}`,
          filename: "photo.png",
        }),
      );
    });
    const onClose = vi.fn();
    const { container } = render(
      <CreateImageDialog open onClose={onClose} canvasId="canvas-1" />,
    );
    await pickFile(container);
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onClose).toHaveBeenCalled();
    expect(deletes()).toEqual(["/api/v1/uploads/asset-1"]);
  });
});
