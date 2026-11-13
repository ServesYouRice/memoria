// @vitest-environment happy-dom

import React from "react";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ExportDialog } from "@/features/canvas/components/ExportDialog";
import { ImportCanvasDialog } from "@/features/dashboard/components/ImportCanvasDialog";
import type { CanvasItem } from "@/types/canvas";

const CANVAS = "ckcanvas00000000000000000";

function item(id: string, type: string, content: object): CanvasItem {
  return {
    id,
    canvasId: CANVAS,
    type,
    positionX: 0,
    positionY: 0,
    width: 100,
    height: 100,
    zIndex: 0,
    content,
    tags: [],
    version: 1,
  } as unknown as CanvasItem;
}

const blobs: Blob[] = [];
beforeEach(() => {
  blobs.length = 0;
  URL.createObjectURL = vi.fn((blob: Blob) => {
    blobs.push(blob);
    return "blob:x";
  }) as typeof URL.createObjectURL;
  URL.revokeObjectURL = vi.fn();
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe(".canvas export (IMP-096)", () => {
  it("lists what the format cannot hold before the download, then saves a JSON Canvas file", async () => {
    const items = [
      item("n", "NOTE", { text: "<p>Hi</p>", plainText: "Hi" }),
      item("d", "DRAWING", { paths: [] }),
    ];
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({
          items,
          total: 2,
          limit: 500,
          hasMore: false,
          nextCursor: null,
          truncatedByBytes: false,
        }),
      ),
    );
    const onClose = vi.fn();
    render(
      <ExportDialog
        open
        onClose={onClose}
        canvasId={CANVAS}
        canvasName="Trip"
        items={items}
        stageRef={{ current: null }}
      />,
    );
    fireEvent.click(screen.getByLabelText(/JSON Canvas/));
    expect(screen.getByText(/cannot hold: 1 free drawings/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Export" }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    const file = JSON.parse(await blobs[0]!.text());
    expect(file.nodes).toEqual([
      expect.objectContaining({ id: "n", type: "text", text: "Hi" }),
    ]);
    expect(file.edges).toEqual([]);
  });
});

describe("opening a canvas file (IMP-096)", () => {
  it("uploads the file and shows what was brought in and left out", async () => {
    const fetchMock = vi.fn(async () =>
      Response.json(
        {
          canvasId: "c1",
          name: "Trip",
          format: "json-canvas",
          itemCount: 3,
          brought: { notes: 2, links: 1 },
          leftOut: { "files from the author's computer": 1 },
        },
        { status: 201 },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);
    const onOpen = vi.fn();
    render(
      <QueryClientProvider client={new QueryClient()}>
        <ImportCanvasDialog open onClose={vi.fn()} onOpenCanvas={onOpen} />
      </QueryClientProvider>,
    );
    fireEvent.change(screen.getByLabelText("Canvas file"), {
      target: { files: [new File(["{}"], "Trip.canvas")] },
    });
    fireEvent.click(screen.getByRole("button", { name: "Open" }));
    expect(await screen.findByText("2 notes, 1 links")).toBeTruthy();
    expect(screen.getByText("1 files from the author's computer")).toBeTruthy();
    const [url, init] = fetchMock.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ];
    expect(url).toBe("/api/v1/canvases/import");
    expect((init.body as FormData).get("file")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Open canvas" }));
    expect(onOpen).toHaveBeenCalledWith("c1");
  });

  it("shows the server's reason when a file cannot be opened", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json(
          { detail: "This file is not valid JSON." },
          { status: 400 },
        ),
      ),
    );
    render(
      <QueryClientProvider client={new QueryClient()}>
        <ImportCanvasDialog open onClose={vi.fn()} onOpenCanvas={vi.fn()} />
      </QueryClientProvider>,
    );
    fireEvent.change(screen.getByLabelText("Canvas file"), {
      target: { files: [new File(["x"], "a.canvas")] },
    });
    fireEvent.click(screen.getByRole("button", { name: "Open" }));
    expect(
      await screen.findByText("This file is not valid JSON."),
    ).toBeTruthy();
  });
});
