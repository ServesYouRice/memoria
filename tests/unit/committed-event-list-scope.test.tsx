// @vitest-environment happy-dom
import React from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const apiFetch = vi.hoisted(() => vi.fn());
vi.mock("sonner", () => ({ toast: { error: vi.fn() } }));
vi.mock("@/lib/api/fetch-client", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  apiFetch,
}));

import {
  canvasItemKeys,
  mergeCommittedCanvasItemEvents,
  useDeleteCanvasItem,
} from "@/lib/hooks/use-canvas-items";
import { type CanvasItem, ItemType } from "@/types/canvas";

const inside = { minX: 0, maxX: 500, minY: 0, maxY: 500 };
const outside = { minX: 5000, maxX: 6000, minY: 5000, maxY: 6000 };

function note(id: string, canvasId: string, x = 100, y = 100): CanvasItem {
  return {
    id,
    canvasId,
    type: ItemType.NOTE,
    positionX: x,
    positionY: y,
    width: 100,
    height: 100,
    zIndex: 1,
    content: { text: id },
    version: 1,
    createdAt: new Date(),
    updatedAt: new Date(),
  } as CanvasItem;
}

function accessibleKey(canvasId: string) {
  return [...canvasItemKeys.list(canvasId), "accessible"] as const;
}

function seed() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  for (const canvasId of ["A", "B"]) {
    queryClient.setQueryData(canvasItemKeys.list(canvasId, undefined, inside), {
      items: [],
    });
    queryClient.setQueryData(accessibleKey(canvasId), {
      pages: [{ items: [], total: 0, hasMore: false }],
      pageParams: [null],
    });
  }
  queryClient.setQueryData(canvasItemKeys.list("A", undefined, outside), {
    items: [],
  });
  return queryClient;
}

const ids = (queryClient: QueryClient, key: readonly unknown[]) =>
  (queryClient.getQueryData<{ items: CanvasItem[] }>(key)?.items ?? []).map(
    (item) => item.id,
  );

beforeEach(() => apiFetch.mockReset());

describe("committed-event merge scope", () => {
  it("adds a new item only to its own canvas and the windows that contain it", async () => {
    const queryClient = seed();
    apiFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ items: [note("n1", "A")] }),
    });
    await mergeCommittedCanvasItemEvents(queryClient, "A", [
      {
        schemaVersion: 1,
        cursor: "10",
        operation: "created",
        entity: { type: "canvas-item", id: "n1", version: 1 },
      },
    ]);

    expect(
      ids(queryClient, canvasItemKeys.list("A", undefined, inside)),
    ).toEqual(["n1"]);
    expect(
      ids(queryClient, canvasItemKeys.list("A", undefined, outside)),
    ).toEqual([]);
    expect(
      ids(queryClient, canvasItemKeys.list("B", undefined, inside)),
    ).toEqual([]);
    const accessible = (canvasId: string) =>
      queryClient.getQueryData<{
        pages: Array<{ items: CanvasItem[]; total: number }>;
      }>(accessibleKey(canvasId))!.pages[0]!;
    expect(accessible("A").items.map((item) => item.id)).toEqual(["n1"]);
    expect(accessible("A").total).toBe(1);
    expect(accessible("B").items).toEqual([]);
    expect(accessible("B").total).toBe(0);
  });

  it("restores a failed delete only into lists of the item's canvas and window", async () => {
    const queryClient = seed();
    const item = note("n2", "A");
    queryClient.setQueryData(canvasItemKeys.list("A", undefined, inside), {
      items: [item],
    });
    apiFetch.mockResolvedValue({
      ok: false,
      status: 500,
      json: async () => ({ detail: "boom" }),
    });
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );
    const { result } = renderHook(() => useDeleteCanvasItem(), { wrapper });
    await act(async () => {
      await result.current
        .mutateAsync({ itemId: "n2", version: 1, canvasId: "A" })
        .catch(() => {});
    });

    expect(
      ids(queryClient, canvasItemKeys.list("A", undefined, inside)),
    ).toEqual(["n2"]);
    expect(
      ids(queryClient, canvasItemKeys.list("A", undefined, outside)),
    ).toEqual([]);
    expect(
      ids(queryClient, canvasItemKeys.list("B", undefined, inside)),
    ).toEqual([]);
  });
});
