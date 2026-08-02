import { afterEach, describe, expect, it, vi } from "vitest";
import { QueryClient } from "@tanstack/react-query";
import {
  canvasItemKeys,
  mergeCommittedCanvasItemEvent,
} from "@/lib/hooks/use-canvas-items";

const item = {
  id: "clitem12345678901234567890",
  canvasId: "clcanvas123456789012345678",
  type: "NOTE",
  positionX: 0,
  positionY: 0,
  width: 200,
  height: 120,
  zIndex: 0,
  content: {
    formatVersion: 1,
    document: { type: "doc", content: [] },
    plainText: "Hello",
    text: "<p>Hello</p>",
  },
  tags: [],
  version: 2,
  deletedAt: null,
  createdById: "user-1",
  updatedById: "user-1",
  deletedById: null,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};

afterEach(() => vi.unstubAllGlobals());

describe("committed client item recovery", () => {
  it("merges an updated item without refetching the active canvas set", async () => {
    const queryClient = new QueryClient();
    queryClient.setQueryData(canvasItemKeys.list(item.canvasId), {
      items: [item],
      total: 1,
    });

    const updated = {
      ...item,
      version: 3,
      content: { ...item.content, plainText: "Updated" },
    };
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify(updated), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      ),
    );

    await mergeCommittedCanvasItemEvent(queryClient, {
      schemaVersion: 1,
      cursor: "9",
      operation: "updated",
      entity: { type: "canvas-item", id: item.id, version: 3 },
    });

    expect(
      queryClient.getQueryData(canvasItemKeys.list(item.canvasId)),
    ).toMatchObject({
      items: [{ id: item.id, version: 3 }],
    });
    expect(fetch).toHaveBeenCalledWith(
      `/api/v1/canvas-items/${item.id}`,
      undefined,
    );
  });

  it("applies a newer deletion tombstone and keeps newer local state", async () => {
    const queryClient = new QueryClient();
    queryClient.setQueryData(canvasItemKeys.list(item.canvasId), {
      items: [item],
      total: 1,
    });

    await mergeCommittedCanvasItemEvent(queryClient, {
      schemaVersion: 1,
      cursor: "10",
      operation: "deleted",
      entity: { type: "canvas-item", id: item.id, version: 2 },
    });

    expect(
      queryClient.getQueryData(canvasItemKeys.list(item.canvasId)),
    ).toMatchObject({
      items: [],
    });
  });
});
