// @vitest-environment happy-dom

import React from "react";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ExportDialog } from "@/features/canvas/components/ExportDialog";
import type { CanvasItem } from "@/types/canvas";

const CANVAS = "ckcanvas00000000000000000";

function item(id: string, text = id): CanvasItem {
  return {
    id,
    canvasId: CANVAS,
    type: "NOTE",
    positionX: 0,
    positionY: 0,
    width: 100,
    height: 100,
    zIndex: 0,
    content: { text },
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

function page(items: CanvasItem[], nextCursor: string | null) {
  return new Response(
    JSON.stringify({
      items,
      total: 3,
      limit: 2,
      hasMore: nextCursor !== null,
      nextCursor,
      truncatedByBytes: false,
    }),
    { status: 200, headers: { "content-type": "application/json" } },
  );
}

async function exportAs(label: RegExp) {
  fireEvent.click(screen.getByLabelText(label));
  fireEvent.click(screen.getByRole("button", { name: "Export" }));
}

describe("ExportDialog full-canvas export", () => {
  it("exports every item of the canvas, not only the viewport working set", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(page([item("a"), item("b", "server b")], "cur-1"))
      .mockResolvedValueOnce(page([item("c")], null));
    vi.stubGlobal("fetch", fetchMock);
    const onClose = vi.fn();
    render(
      <ExportDialog
        open
        onClose={onClose}
        canvasId={CANVAS}
        canvasName="Board"
        items={[item("b", "live b"), item("local")]}
        stageRef={{ current: null }}
      />,
    );
    await exportAs(/JSON/);
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    const json = JSON.parse(await blobs[0].text());
    expect(json.items.map((entry: CanvasItem) => entry.id)).toEqual([
      "a",
      "b",
      "c",
      "local",
    ]);
    expect(json.items[1].content.text).toBe("live b");
    const urls = fetchMock.mock.calls.map(([url]) => String(url));
    expect(urls[0]).toContain(`canvasId=${CANVAS}`);
    expect(urls[0]).not.toMatch(/minX|tag=/);
    expect(urls[1]).toContain("cursor=cur-1");
  });

  it("shows an error and downloads nothing when the full listing fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response("nope", { status: 500 })),
    );
    const onClose = vi.fn();
    render(
      <ExportDialog
        open
        onClose={onClose}
        canvasId={CANVAS}
        canvasName="Board"
        items={[item("a")]}
        stageRef={{ current: null }}
      />,
    );
    await exportAs(/Markdown/);
    expect((await screen.findByRole("alert")).textContent).toMatch(/export/i);
    expect(blobs).toHaveLength(0);
    expect(onClose).not.toHaveBeenCalled();
  });
});
