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
