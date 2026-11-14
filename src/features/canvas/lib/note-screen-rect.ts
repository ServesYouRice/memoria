import { ItemType, type CanvasItem } from "@/types/canvas";

export interface NoteScreenRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

/**
 * Where an item is drawn on screen, relative to the stage container. The
 * Stage renders a world point at `world * zoom + position`.
 */
export function noteScreenRect(
  item: Pick<CanvasItem, "positionX" | "positionY" | "width" | "height">,
  position: { x: number; y: number },
  zoom: number,
): NoteScreenRect {
  return {
    left: item.positionX * zoom + position.x,
    top: item.positionY * zoom + position.y,
    width: item.width * zoom,
    height: item.height * zoom,
  };
}

/** Below this on-screen width a note is edited in the dialog instead. */
export const MIN_IN_PLACE_NOTE_WIDTH = 160;

/**
 * IMP-142: a note is typed on in place when it is a NOTE (TEXT items keep the
 * form), its text can be edited live, and it is wide enough on screen to type
 * in. Everything else opens the note dialog.
 */
export function editsNoteInPlace(
  item: Pick<CanvasItem, "type" | "width">,
  zoom: number,
  liveEditing: boolean,
): boolean {
  return (
    item.type === ItemType.NOTE &&
    liveEditing &&
    item.width * zoom >= MIN_IN_PLACE_NOTE_WIDTH
  );
}
