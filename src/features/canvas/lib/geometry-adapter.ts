/**
 * IMP-008 — shared geometry adapter helpers.
 *
 * Item types that position a Konva `Group` at `item.positionX/positionY` all
 * commit a move the same way. Keeping that in one helper is what makes "one
 * gesture, one durable write" hold across every type instead of per-component.
 *
 * @module features/canvas/lib/geometry-adapter
 */

import type { ItemGeometryCommit } from "@/types/canvas";

/** Minimal shape of the Konva drag event this module needs. */
interface DragEndEventLike {
  target: { x: () => number; y: () => number };
}

/**
 * Translate a Konva group drag-end into a geometry commit. Position only — a
 * drag never changes size.
 */
export function commitGroupDragEnd(
  event: DragEndEventLike,
  onCommitGeometry: (geometry: ItemGeometryCommit) => void,
): void {
  onCommitGeometry({
    positionX: event.target.x(),
    positionY: event.target.y(),
  });
}

export type ResizeCorner = "se" | "sw" | "ne" | "nw";

/**
 * New geometry for dragging one corner to `pointer`. Everything is in world
 * (layer) space: pass the Stage's relative pointer, never the container
 * pointer, or zoom and pan skew the result. The opposite corner stays put and
 * the size never drops below `min`.
 */
export function resizeFromCorner(
  corner: ResizeCorner,
  pointer: { x: number; y: number },
  position: { x: number; y: number },
  size: { width: number; height: number },
  min: { width: number; height: number },
) {
  const right = position.x + size.width;
  const bottom = position.y + size.height;
  const fromLeft = corner === "sw" || corner === "nw";
  const fromTop = corner === "ne" || corner === "nw";
  const width = Math.max(
    min.width,
    fromLeft ? right - pointer.x : pointer.x - position.x,
  );
  const height = Math.max(
    min.height,
    fromTop ? bottom - pointer.y : pointer.y - position.y,
  );
  return {
    width,
    height,
    x: fromLeft ? right - width : position.x,
    y: fromTop ? bottom - height : position.y,
  };
}

/** Where a corner's handle sits in the item Group's local coordinates. */
export function cornerHandlePosition(
  corner: ResizeCorner,
  size: { width: number; height: number },
) {
  return {
    x: corner === "se" || corner === "ne" ? size.width : 0,
    y: corner === "se" || corner === "sw" ? size.height : 0,
  };
}
