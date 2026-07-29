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

import { useCallback, useEffect, useRef } from "react";
import { SerializedDeltaQueue } from "@/lib/autosave/serialized-delta-queue";
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

  const queuesRef = useRef(
    new Map<string, SerializedDeltaQueue<UpdateCanvasItemInput>>(),
  );

  // Flush anything still queued when the canvas unmounts, so a move made just
  // before navigation is not silently dropped.
  useEffect(() => {
    const queues = queuesRef.current;
    return () => {
      for (const queue of queues.values()) {
        void queue.flush().catch(() => {});
      }
      queues.clear();
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
          (_status, error) => {
            if (error) onErrorRef.current?.(error);
          },
        );
        queuesRef.current.set(item.id, queue);
      }

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

  return { commitGeometry };
}
