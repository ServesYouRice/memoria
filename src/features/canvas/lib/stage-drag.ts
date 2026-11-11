/**
 * Konva bubbles dragmove/dragend from draggable item Groups up to the Stage.
 * The Stage's pan handlers must only follow drags of the Stage itself, or a
 * dragged item's world coordinates would be written into the viewport
 * position and fight the pointer.
 */
interface DragTarget {
  x(): number;
  y(): number;
  getStage(): unknown;
}

/** The new stage position for a Stage drag event, or null for a bubbled one. */
export function stageDragPosition(event: {
  target: DragTarget;
}): { x: number; y: number } | null {
  if (event.target !== event.target.getStage()) return null;
  return { x: event.target.x(), y: event.target.y() };
}
