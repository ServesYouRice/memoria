/**
 * IMP-008 — the single parent-owned geometry write path.
 *
 * Every move and resize, for every item type, funnels through this hook. One
 * gesture produces one durable write: deltas for the same item are serialized
 * through a `SerializedDeltaQueue`, so an in-flight save absorbs the next
 * gesture instead of racing it, and each item's optimistic version advances
 * exactly once per accepted write.
 *
 * @module features/canvas/hooks/use-item-geometry
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { SerializedDeltaQueue } from "@/lib/autosave/serialized-delta-queue";
import type { AutosaveStatus } from "@/lib/autosave/serialized-delta-queue";
import { useUpdateCanvasItem } from "@/lib/hooks/use-canvas-items";
import type { UpdateCanvasItemInput } from "@/lib/validation/canvas-item";
import {
  type CanvasCapabilities,
  type CanvasItem,
  type ItemGeometryCommit,
  isItemResizable,
} from "@/types/canvas";

interface UseItemGeometryOptions {
  capabilities: CanvasCapabilities;
  onError?: (error: Error) => void;
}

export interface ItemGeometryController {
  /**
   * Commit one gesture. Returns `false` when the capability contract rejects
   * it, so callers can tell "not permitted" from "queued".
   */
  commitGeometry: (item: CanvasItem, geometry: ItemGeometryCommit) => boolean;
  /**
   * Move an item by a delta (keyboard nudge) through the same queue. The
   * delta applies to the latest committed position, so repeated presses
   * while a save is in flight accumulate instead of reusing a stale one.
   */
  nudgeGeometry: (item: CanvasItem, deltaX: number, deltaY: number) => boolean;
  status: AutosaveStatus;
  error: Error | null;
}

export interface GeometryStatusEntry {
  status: AutosaveStatus;
  error: Error | null;
}

const ERROR_STATUSES: ReadonlySet<AutosaveStatus> = new Set([
  "failed",
  "conflict",
  "offline/retrying",
]);

/**
 * One status for every item's queue: any unsaved failure wins, then any save
 * in flight, else saved. One item's success never hides another's failure.
 */
export function aggregateGeometryStatus(
  entries: Iterable<GeometryStatusEntry>,
): GeometryStatusEntry {
  let saving = false;
  for (const entry of entries) {
    if (ERROR_STATUSES.has(entry.status) || entry.error) {
      return { status: entry.status, error: entry.error };
    }
    if (entry.status === "saving") saving = true;
  }
  return { status: saving ? "saving" : "saved", error: null };
}

export function useItemGeometry({
  capabilities,
  onError,
}: UseItemGeometryOptions): ItemGeometryController {
  const updateItem = useUpdateCanvasItem();
  const mutationRef = useRef(updateItem);
  mutationRef.current = updateItem;

  const onErrorRef = useRef(onError);
  onErrorRef.current = onError;

  const capabilitiesRef = useRef(capabilities);
  capabilitiesRef.current = capabilities;
  // Per-item status; the exposed status and error are derived from all of
  // them so the last callback cannot overwrite another item's failure.
  const statusesRef = useRef(new Map<string, GeometryStatusEntry>());
  const [aggregate, setAggregate] = useState<GeometryStatusEntry>({
    status: "saved",
    error: null,
  });

  const queuesRef = useRef(
    new Map<string, SerializedDeltaQueue<UpdateCanvasItemInput>>(),
  );
  // Position last committed per item while its queue has unsaved work.
  const latestPositionRef = useRef(
    new Map<string, { positionX: number; positionY: number }>(),
  );

  // Flush anything still queued when the canvas unmounts, so a move made just
  // before navigation is not silently dropped.
  useEffect(() => {
    const queues = queuesRef.current;
    const statuses = statusesRef.current;
    return () => {
      for (const queue of queues.values()) {
        void queue.flush().catch(() => {});
        // The final flush is the last attempt; no retry outlives the canvas.
        queue.dispose();
      }
      queues.clear();
      statuses.clear();
    };
  }, []);

  const commitGeometry = useCallback(
    (item: CanvasItem, geometry: ItemGeometryCommit): boolean => {
      const current = capabilitiesRef.current;
      const isResize =
        geometry.width !== undefined || geometry.height !== undefined;

      if (isResize) {
        if (!current.canResizeItems || !isItemResizable(item.type))
          return false;
      } else if (!current.canMoveItems) {
        return false;
      }

      let queue = queuesRef.current.get(item.id);
      if (!queue) {
        queue = new SerializedDeltaQueue<UpdateCanvasItemInput>(
          item.version,
          async (delta) =>
            mutationRef.current.mutateAsync({ itemId: item.id, data: delta }),
          (nextStatus, nextError) => {
            const statuses = statusesRef.current;
            if (nextStatus === "saved" || nextStatus === "conflict") {
              // A conflicted delta is dropped, so later nudges start from
              // the item's own position again.
              latestPositionRef.current.delete(item.id);
            }
            if (nextStatus === "saved") statuses.delete(item.id);
            else
              statuses.set(item.id, {
                status: nextStatus,
                error: nextError || null,
              });
            setAggregate(aggregateGeometryStatus(statuses.values()));
            if (nextError) onErrorRef.current?.(nextError);
          },
        );
        queuesRef.current.set(item.id, queue);
      }

      // The item may carry a newer version than the queue has seen.
      queue.observeVersion(item.version);
      latestPositionRef.current.set(item.id, {
        positionX: geometry.positionX,
        positionY: geometry.positionY,
      });
      queue.enqueue({
        positionX: geometry.positionX,
        positionY: geometry.positionY,
        ...(geometry.width !== undefined ? { width: geometry.width } : {}),
        ...(geometry.height !== undefined ? { height: geometry.height } : {}),
      } as Partial<UpdateCanvasItemInput>);

      void queue.flush().catch(() => {});
      return true;
    },
    [],
  );

  const nudgeGeometry = useCallback(
    (item: CanvasItem, deltaX: number, deltaY: number): boolean => {
      const base = latestPositionRef.current.get(item.id) ?? item;
      return commitGeometry(item, {
        positionX: base.positionX + deltaX,
        positionY: base.positionY + deltaY,
      });
    },
    [commitGeometry],
  );

  return {
    commitGeometry,
    nudgeGeometry,
    status: aggregate.status,
    error: aggregate.error,
  };
}
