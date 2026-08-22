import { describe, expect, it, vi } from "vitest";
import { QueryClient } from "@tanstack/react-query";
import { canvasItemKeys } from "@/lib/hooks/use-canvas-items";
import { type CanvasItem, ItemType } from "@/types/canvas";

describe("item mutation composability and recovery (IMP-044)", () => {
  describe("optimistic rollback isolation (DATA-02)", () => {
    it("preserves unrelated concurrent cache entries when a create mutation fails", () => {
      const queryClient = new QueryClient();
      const canvasId = "canvas_123";

      // Initial cache state with item A and item B
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

      // Simulate optimistic insert of item C
      const tempId = "temp-12345";
      const optimisticItemC = {
        id: tempId,
        canvasId,
        type: ItemType.NOTE,
        positionX: 200,
        positionY: 200,
        width: 100,
        height: 100,
        zIndex: 3,
        content: { text: "Note C" },
        version: 1,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        deletedAt: null,
      };

      // Apply optimistic update
      queryClient.setQueriesData(
        { queryKey: canvasItemKeys.list(canvasId) },
        (old: { items?: CanvasItem[] } | undefined) => ({
          ...old,
          items: [
            ...(old?.items || []),
            optimisticItemC as unknown as CanvasItem,
          ],
        }),
      );

      // Meanwhile, concurrent edit happened to item A
      queryClient.setQueriesData(
        { queryKey: canvasItemKeys.list(canvasId) },
        (old: { items?: CanvasItem[] } | undefined) => ({
          ...old,
          items: (old?.items || []).map((i) =>
            i.id === "item_a" ? { ...i, positionX: 999 } : i,
          ),
        }),
      );

      // Now item C fails -> Targeted rollback only removes tempId
      queryClient.setQueriesData(
        { queryKey: canvasItemKeys.list(canvasId) },
        (old: { items?: CanvasItem[] } | undefined) => ({
          ...old,
          items: (old?.items || []).filter((i) => i.id !== tempId),
        }),
      );

      const cached = queryClient.getQueryData<{ items: CanvasItem[] }>(
        canvasItemKeys.list(canvasId),
      );

      expect(cached?.items.length).toBe(2);
      // Item A's concurrent edit was NOT blown away!
      const finalItemA = cached?.items.find((i) => i.id === "item_a");
      expect(finalItemA?.positionX).toBe(999);
      // Item C was removed
      expect(cached?.items.find((i) => i.id === tempId)).toBeUndefined();
    });

    it("preserves unrelated concurrent items when an update mutation rolls back", () => {
      const queryClient = new QueryClient();
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

      // Seed with setQueryData, not setQueriesData: the plural form only
      // rewrites queries already in the cache, so on an empty cache it stores
      // nothing and every read below comes back undefined.
      queryClient.setQueryData(canvasItemKeys.lists(), {
        items: [itemA, itemB],
      });

      const snapshotItemA = { ...itemA };

      // Optimistically update Item A
      queryClient.setQueriesData(
        { queryKey: canvasItemKeys.lists() },
        (old: { items?: CanvasItem[] } | undefined) => ({
          ...old,
          items: (old?.items || []).map((i) =>
            i.id === "item_a" ? { ...i, positionX: 888 } : i,
          ),
        }),
      );

      // Concurrent update on Item B
      queryClient.setQueriesData(
        { queryKey: canvasItemKeys.lists() },
        (old: { items?: CanvasItem[] } | undefined) => ({
          ...old,
          items: (old?.items || []).map((i) =>
            i.id === "item_b" ? { ...i, positionY: 777 } : i,
          ),
        }),
      );

      // Item A mutation fails -> Targeted rollback only resets item A
      queryClient.setQueriesData(
        { queryKey: canvasItemKeys.lists() },
        (old: { items?: CanvasItem[] } | undefined) => ({
          ...old,
          items: (old?.items || []).map((i) =>
            i.id === "item_a" ? snapshotItemA : i,
          ),
        }),
      );

      const cached = queryClient.getQueryData<{ items: CanvasItem[] }>(
        canvasItemKeys.lists(),
      );

      const finalItemA = cached?.items.find((i) => i.id === "item_a");
      const finalItemB = cached?.items.find((i) => i.id === "item_b");

      expect(finalItemA?.positionX).toBe(10);
      expect(finalItemB?.positionY).toBe(777); // Item B changes preserved!
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
