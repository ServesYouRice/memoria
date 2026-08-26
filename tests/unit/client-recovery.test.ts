import { afterEach, describe, expect, it, vi } from "vitest";
import { QueryClient } from "@tanstack/react-query";
import {
  canvasItemKeys,
  mergeCommittedCanvasItemEvent,
  mergeCommittedCanvasItemEvents,
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

  it("hydrates a committed update burst with one bounded HTTP read", async () => {
    const queryClient = new QueryClient();
    const existingItems = Array.from({ length: 50 }, (_, index) => ({
      ...item,
      id: `item-${index}`,
      version: 1,
    }));
    queryClient.setQueryData(canvasItemKeys.list(item.canvasId), {
      items: existingItems,
      total: existingItems.length,
    });
    const updatedItems = existingItems.map((candidate) => ({
      ...candidate,
      version: 2,
      content: { ...candidate.content, plainText: `Updated ${candidate.id}` },
    }));
    const events = updatedItems.map((candidate, index) => ({
      schemaVersion: 1 as const,
      cursor: String(index + 1),
      operation: "updated" as const,
      entity: {
        type: "canvas-item" as const,
        id: candidate.id,
        version: candidate.version,
      },
    }));
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ items: updatedItems }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await mergeCommittedCanvasItemEvents(queryClient, item.canvasId, events);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]![0]).toContain(
      `/api/v1/canvas-items?canvasId=${item.canvasId}&ids=`,
    );
    expect(
      queryClient.getQueryData<{ items: typeof updatedItems }>(
        canvasItemKeys.list(item.canvasId),
      )?.items,
    ).toHaveLength(50);
    expect(
      queryClient
        .getQueryData<{ items: typeof updatedItems }>(
          canvasItemKeys.list(item.canvasId),
        )
        ?.items.every((candidate) => candidate.version === 2),
    ).toBe(true);
  });
});
