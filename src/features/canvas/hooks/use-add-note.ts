"use client";

/**
 * IMP-143: "Note" drops an empty note in the middle of what the person is
 * looking at, ready to type on in place (IMP-142). Without live editing the
 * note dialog opens instead.
 */

import { useCallback, useRef } from "react";
import { toast } from "sonner";
import { EMPTY_VERSIONED_NOTE_CONTENT } from "@/components/RichTextEditor";
import { viewportCenterWorld } from "@/features/canvas/components/viewport-center";
import { editsNoteInPlace } from "@/features/canvas/lib/note-screen-rect";
import type { CreateCanvasItemInput } from "@/lib/validation/canvas-item";
import { ItemType, type CanvasItem } from "@/types/canvas";

/** A new note's width and height, as the note dialog creates it. */
export const NEW_NOTE_SIZE = 200;
/** How far a new note moves off one that already sits exactly there. */
export const NEW_NOTE_STEP = 24;
const MAX_NEW_NOTE_STEPS = 10;

type Point = { x: number; y: number };

/**
 * Where a new note goes: centred on `center`, moved down and right while
 * another item sits at exactly that spot, so notes do not hide each other.
 */
export function newNotePosition(
  center: Point,
  items: ReadonlyArray<Pick<CanvasItem, "positionX" | "positionY">>,
): Point {
  let x = center.x - NEW_NOTE_SIZE / 2;
  let y = center.y - NEW_NOTE_SIZE / 2;
  for (
    let step = 0;
    step < MAX_NEW_NOTE_STEPS &&
    items.some((item) => item.positionX === x && item.positionY === y);
    step++
  ) {
    x += NEW_NOTE_STEP;
    y += NEW_NOTE_STEP;
  }
  return { x, y };
}

export interface UseAddNoteOptions {
  canvasId: string;
  canCreateItems: boolean;
  /** The canvas document is open and writable (`liveEditingAvailable`). */
  liveEditing: boolean;
  position: Point;
  stageSize: { width: number; height: number };
  zoom: number;
  items: ReadonlyArray<CanvasItem>;
  /** The note dialog's own create call (`useCreateCanvasItem`). */
  createItem: (input: CreateCanvasItemInput) => Promise<CanvasItem>;
  openDialog: () => void;
  /** The new note exists; `inPlace` when it is wide enough to type on. */
  onCreated: (item: CanvasItem, inPlace: boolean) => void;
}

/** Returns the "Note" action. One press makes one note, even when slow. */
export function useAddNote(options: UseAddNoteOptions): () => Promise<void> {
  const latest = useRef(options);
  latest.current = options;
  const pending = useRef(false);

  return useCallback(async () => {
    const {
      canvasId,
      canCreateItems,
      liveEditing,
      position,
      stageSize,
      zoom,
      items,
      createItem,
      openDialog,
      onCreated,
    } = latest.current;
    if (!canCreateItems) return;
    if (!liveEditing) {
      openDialog();
      return;
    }
    if (pending.current) return;
    pending.current = true;
    const spot = newNotePosition(
      viewportCenterWorld(position, stageSize, zoom),
      items,
    );
    try {
      const created = await createItem({
        canvasId,
        type: ItemType.NOTE,
        positionX: spot.x,
        positionY: spot.y,
        width: NEW_NOTE_SIZE,
        height: NEW_NOTE_SIZE,
        zIndex: items.length + 1,
        content: EMPTY_VERSIONED_NOTE_CONTENT,
        tags: [],
      });
      onCreated(created, editsNoteInPlace(created, zoom, true));
    } catch {
      toast.error("The note was not added.");
    } finally {
      pending.current = false;
    }
  }, []);
}
