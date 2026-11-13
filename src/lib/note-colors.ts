/**
 * IMP-085: the fixed list of sticky-note colours. A note stores one of these
 * names in `content.color`; a note without one is yellow. Shared by the
 * validator, the sync server and the canvas, so it holds names only (the
 * colour values per theme live in `features/canvas/lib/note-colors.ts`).
 */
export const NOTE_COLOR_NAMES = [
  "yellow",
  "pink",
  "blue",
  "green",
  "purple",
  "orange",
] as const;

export type NoteColorName = (typeof NOTE_COLOR_NAMES)[number];

export const DEFAULT_NOTE_COLOR: NoteColorName = "yellow";

export function isNoteColorName(value: unknown): value is NoteColorName {
  return (
    typeof value === "string" &&
    (NOTE_COLOR_NAMES as readonly string[]).includes(value)
  );
}

/** The colour a stored note is drawn in: its own, or yellow. */
export function noteColorOf(content: unknown): NoteColorName {
  const color =
    content && typeof content === "object"
      ? (content as { color?: unknown }).color
      : undefined;
  return isNoteColorName(color) ? color : DEFAULT_NOTE_COLOR;
}
