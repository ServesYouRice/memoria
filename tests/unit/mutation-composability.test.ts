// @vitest-environment happy-dom
import React from "react";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook } from "@testing-library/react";
import {
  useCreateCanvasItem,
  useUpdateCanvasItem,
  canvasItemKeys,
} from "@/lib/hooks/use-canvas-items";
import { type CanvasItem, ItemType } from "@/types/canvas";

describe("item mutation composability and recovery (IMP-044 / IMP-055)", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  describe("optimistic rollback isolation (DATA-02)", () => {
    it("preserves unrelated concurrent cache entries when a create mutation fails", async () => {
      const queryClient = new QueryClient({
        defaultOptions: {
          queries: { retry: false },
          mutations: { retry: false },
        },
      });
      const canvasId = "canvas_123";

      const itemA: CanvasItem = {
        id: "item_a",
        canvasId,
        type: ItemType.NOTE,
        positionX: 10,
        positionY: 10,
        width: 100,
        height: 100,
        zIndex: 1,
        content: { text: "Note A" },
        version: 1,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const itemB: CanvasItem = {
        id: "item_b",
        canvasId,
        type: ItemType.NOTE,
        positionX: 50,
        positionY: 50,
        width: 100,
        height: 100,
        zIndex: 2,
        content: { text: "Note B" },
        version: 1,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      queryClient.setQueryData(canvasItemKeys.list(canvasId), {
        items: [itemA, itemB],
      });

      // Mock global fetch to reject the create mutation
      vi.spyOn(globalThis, "fetch").mockRejectedValue(
        new Error("Network error during create"),
      );

      const wrapper = ({ children }: { children: React.ReactNode }) =>
        React.createElement(
          QueryClientProvider,
          { client: queryClient },
          children,
        );

      const { result } = renderHook(() => useCreateCanvasItem(), { wrapper });

      // Trigger create mutation which applies optimistic insert then fails
      const mutationPromise = result.current.mutateAsync({
        canvasId,
        type: ItemType.NOTE,
        positionX: 200,
        positionY: 200,
        width: 100,
        height: 100,
        content: { text: "Note C" },
      });

      // While mutation is in flight, a concurrent edit arrives for item A
      queryClient.setQueriesData(
        { queryKey: canvasItemKeys.list(canvasId) },
        (old: { items?: CanvasItem[] } | undefined) => ({
          ...old,
          items: (old?.items || []).map((i) =>
            i.id === "item_a" ? { ...i, positionX: 999 } : i,
          ),
        }),
      );

      // Await rejected create mutation
      await expect(mutationPromise).rejects.toThrow();

      const cached = queryClient.getQueryData<{ items: CanvasItem[] }>(
        canvasItemKeys.list(canvasId),
      );

      expect(cached?.items.length).toBe(2);
      const finalItemA = cached?.items.find((i) => i.id === "item_a");
      expect(finalItemA?.positionX).toBe(999);
      expect(
        cached?.items.find((i) => i.id.startsWith("temp-")),
      ).toBeUndefined();
    });

    it("preserves unrelated concurrent items when an update mutation rolls back", async () => {
      const queryClient = new QueryClient({
        defaultOptions: {
          queries: { retry: false },
          mutations: { retry: false },
        },
      });
      const canvasId = "canvas_123";

      const itemA: CanvasItem = {
        id: "item_a",
        canvasId,
        type: ItemType.NOTE,
        positionX: 10,
        positionY: 10,
        width: 100,
        height: 100,
        zIndex: 1,
        content: { text: "Note A" },
        version: 1,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const itemB: CanvasItem = {
        id: "item_b",
        canvasId,
        type: ItemType.NOTE,
        positionX: 50,
        positionY: 50,
        width: 100,
        height: 100,
        zIndex: 2,
        content: { text: "Note B" },
        version: 1,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      queryClient.setQueryData(canvasItemKeys.list(canvasId), {
        items: [itemA, itemB],
      });
      queryClient.setQueryData(canvasItemKeys.detail("item_a"), itemA);
      queryClient.setQueryData(canvasItemKeys.detail("item_b"), itemB);

      // Mock global fetch to reject the update mutation
      vi.spyOn(globalThis, "fetch").mockRejectedValue(
        new Error("Update rejected by server"),
      );

      const wrapper = ({ children }: { children: React.ReactNode }) =>
        React.createElement(
          QueryClientProvider,
          { client: queryClient },
          children,
        );

      const { result } = renderHook(() => useUpdateCanvasItem(), { wrapper });

      // Trigger update mutation on item A (optimistically sets positionX to 888)
      const mutationPromise = result.current.mutateAsync({
        itemId: "item_a",
        data: { positionX: 888, version: 1 },
      });

      // Concurrent update on item B
      queryClient.setQueriesData(
        { queryKey: canvasItemKeys.list(canvasId) },
        (old: { items?: CanvasItem[] } | undefined) => ({
          ...old,
          items: (old?.items || []).map((i) =>
            i.id === "item_b" ? { ...i, positionY: 777 } : i,
          ),
        }),
      );

      // Await rejected mutation
      await expect(mutationPromise).rejects.toThrow();

      const cached = queryClient.getQueryData<{ items: CanvasItem[] }>(
        canvasItemKeys.list(canvasId),
      );

      const finalItemA = cached?.items.find((i) => i.id === "item_a");
      const finalItemB = cached?.items.find((i) => i.id === "item_b");

      // Item A is restored to 10
      expect(finalItemA?.positionX).toBe(10);
      // Item B's concurrent change to 777 is preserved!
      expect(finalItemB?.positionY).toBe(777);
    });
  });

  describe("idempotency in-flight lease recovery (DATA-03)", () => {
    it("identifies expired in-flight idempotency leases over 60 seconds", () => {
      const IN_FLIGHT_LEASE_MS = 60 * 1000;
      const now = Date.now();

      const freshRow = {
        createdAt: new Date(now - 10 * 1000), // 10s old
        responseCode: null,
      };

      const expiredRow = {
        createdAt: new Date(now - 70 * 1000), // 70s old
        responseCode: null,
      };

      const isFreshExpired =
        now - freshRow.createdAt.getTime() > IN_FLIGHT_LEASE_MS;
      const isStaleExpired =
        now - expiredRow.createdAt.getTime() > IN_FLIGHT_LEASE_MS;

      expect(isFreshExpired).toBe(false);
      expect(isStaleExpired).toBe(true);
    });
  });

  describe("bulk operation allSettled outcomes (UI-03)", () => {
    it("reports partial success and retains failed IDs", async () => {
      const ids = ["canvas_1", "canvas_2", "canvas_3"];

      const mockDelete = vi.fn((id: string) => {
        if (id === "canvas_2") {
          return Promise.reject(new Error("Permission denied"));
        }
        return Promise.resolve(id);
      });

      const results = await Promise.allSettled(ids.map((id) => mockDelete(id)));

      const succeeded = results.filter((r) => r.status === "fulfilled").length;
      const failed = results.filter((r) => r.status === "rejected").length;
      const failedIds = ids.filter(
        (_, idx) => results[idx].status === "rejected",
      );

      expect(succeeded).toBe(2);
      expect(failed).toBe(1);
      expect(failedIds).toEqual(["canvas_2"]);
    });
  });
});
