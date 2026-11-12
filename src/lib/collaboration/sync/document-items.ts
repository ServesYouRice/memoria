/**
 * IMP-042 — reading and writing canvas items in a collaborative document.
 *
 * Shared by the sync server (lazy migration, row → document reconciliation),
 * the version route (snapshots from Yjs state), and the browser (rendering and
 * local edits). Validation of client updates lives in `validation.ts`; these
 * helpers only translate between the document shape (`protocol.ts`) and the
 * row-shaped item state `CanvasItem` stores.
 *
 * @module lib/collaboration/sync/document-items
 */

import * as Y from "yjs";
import { ItemType } from "@/types/canvas";
import {
  DOCUMENT_ITEMS_KEY,
  ITEM_GEOMETRY_KEYS,
  NOTE_COLOR_KEY,
  NOTE_TEXT_KEY,
} from "./protocol";
import { DEFAULT_NOTE_COLOR, isNoteColorName } from "@/lib/note-colors";
import {
  canonicalNoteDocument,
  noteDocumentFromContent,
  readNoteFragment,
  writeNoteFragment,
} from "./note-fragment";
import type { TiptapNode } from "@/lib/rich-text/note-format";

export type ItemMap = Y.Map<unknown>;

const EMPTY_NOTE_DOCUMENT: TiptapNode = {
  type: "doc",
  content: [{ type: "paragraph", content: [] }],
};

/** The row-shaped state of one live item, as `CanvasItem` stores it. */
export interface CanvasItemState {
  id: string;
  type: ItemType;
  positionX: number;
  positionY: number;
  width: number;
  height: number;
  zIndex: number;
  tags: string[];
  content: unknown;
}

const ITEM_TYPES = new Set<string>(Object.values(ItemType));

export function documentItems(doc: Y.Doc): Y.Map<ItemMap> {
  return doc.getMap<ItemMap>(DOCUMENT_ITEMS_KEY);
}

/**
 * A canvas document with its item map defined up front. Updates do not carry
 * root types, so a root first met inside an update is untyped and is swapped
 * for a new instance when later read as a map; defining it first keeps the
 * instance seen by transactions and by readers the same.
 */
export function createCanvasYDoc(): Y.Doc {
  const doc = new Y.Doc();
  documentItems(doc);
  return doc;
}

export function isNoteTextFragment(value: unknown): value is Y.XmlFragment {
  return value instanceof Y.XmlFragment && !(value instanceof Y.XmlElement);
}

/** Structural JSON equality that ignores object key order (jsonb reorders keys). */
export function jsonEqual(left: unknown, right: unknown): boolean {
  if (left === right) return true;
  if (typeof left !== typeof right || left === null || right === null)
    return false;
  if (Array.isArray(left)) {
    return (
      Array.isArray(right) &&
      left.length === right.length &&
      left.every((value, index) => jsonEqual(value, right[index]))
    );
  }
  if (typeof left !== "object" || Array.isArray(right)) return false;
  const leftRecord = left as Record<string, unknown>;
  const rightRecord = right as Record<string, unknown>;
  const leftKeys = Object.keys(leftRecord).filter(
    (key) => leftRecord[key] !== undefined,
  );
  const rightKeys = Object.keys(rightRecord).filter(
    (key) => rightRecord[key] !== undefined,
  );
  return (
    leftKeys.length === rightKeys.length &&
    leftKeys.every((key) => jsonEqual(leftRecord[key], rightRecord[key]))
  );
}

/**
 * Read one item map without validating it. The browser renders what the sync
 * server accepted; anything unreadable is skipped rather than thrown.
 */
export function readItemState(
  id: string,
  map: unknown,
): CanvasItemState | null {
  if (!(map instanceof Y.Map)) return null;
  const type = map.get("type");
  if (typeof type !== "string" || !ITEM_TYPES.has(type)) return null;
  const numbers = ITEM_GEOMETRY_KEYS.map((key) => map.get(key));
  if (numbers.some((value) => typeof value !== "number")) return null;
  const [positionX, positionY, width, height, zIndex] = numbers as number[];
  const tags = map.get("tags");
  let content: unknown = map.get("content");
  if (type === ItemType.NOTE) {
    const fragment = map.get(NOTE_TEXT_KEY);
    if (!isNoteTextFragment(fragment)) return null;
    // The browser draws an unknown colour as the default rather than
    // dropping the note.
    const color = map.get(NOTE_COLOR_KEY);
    try {
      content = readNoteFragment(
        fragment,
        isNoteColorName(color) ? color : undefined,
      );
    } catch {
      return null;
    }
  }
  return {
    id,
    type: type as ItemType,
    positionX,
    positionY,
    width,
    height,
    zIndex,
    tags: Array.isArray(tags)
      ? tags.filter((tag): tag is string => typeof tag === "string")
      : [],
    content: content ?? {},
  };
}

export function readAllItemStates(doc: Y.Doc): CanvasItemState[] {
  const states: CanvasItemState[] = [];
  documentItems(doc).forEach((map, id) => {
    const state = readItemState(id, map);
    if (state) states.push(state);
  });
  return states;
}

function fillItemMap(map: ItemMap, state: CanvasItemState, fresh: boolean) {
  const set = (key: string, value: unknown) => {
    if (fresh || !jsonEqual(map.get(key), value)) map.set(key, value);
  };
  if (fresh) map.set("type", state.type);
  for (const key of ITEM_GEOMETRY_KEYS) set(key, state[key]);
  set("tags", [...state.tags]);

  if (state.type !== ItemType.NOTE) {
    if (map.has(NOTE_TEXT_KEY)) map.delete(NOTE_TEXT_KEY);
    if (map.has(NOTE_COLOR_KEY)) map.delete(NOTE_COLOR_KEY);
    set("content", state.content);
    return;
  }

  if (map.has("content")) map.delete("content");
  const color = (state.content as { color?: unknown } | null)?.color;
  if (isNoteColorName(color) && color !== DEFAULT_NOTE_COLOR)
    set(NOTE_COLOR_KEY, color);
  else if (map.has(NOTE_COLOR_KEY)) map.delete(NOTE_COLOR_KEY);
  const normalized = noteDocumentFromContent(state.content);
  let fragment = map.get(NOTE_TEXT_KEY);
  if (!normalized) {
    // Shared with the browser, so no server logger here.
    console.warn(
      `Stored note ${state.id} could not be normalized; keeping its document text.`,
    );
    // An existing note is never overwritten because its row failed to
    // normalize. A note with no text yet still gets an empty one, as before.
    if (isNoteTextFragment(fragment)) return;
  }
  const document = normalized ?? EMPTY_NOTE_DOCUMENT;
  if (!isNoteTextFragment(fragment)) {
    fragment = new Y.XmlFragment();
    map.set(NOTE_TEXT_KEY, fragment);
  } else {
    try {
      const current = canonicalNoteDocument(
        readNoteFragment(fragment).document,
      );
      if (jsonEqual(current, document)) return;
    } catch {
      // Unreadable text is replaced by the stored note below.
    }
  }
  writeNoteFragment(fragment as Y.XmlFragment, document);
}

/**
 * Make the document's item `id` match `state`, or remove it when `state` is
 * null. Unchanged fields and unchanged note nodes are left alone, so the
 * caller can tell whether anything changed from the transaction's update.
 * Call inside `doc.transact`.
 */
export function applyItemState(
  items: Y.Map<ItemMap>,
  id: string,
  state: CanvasItemState | null,
): void {
  const existing = items.get(id);
  if (!state) {
    if (existing !== undefined) items.delete(id);
    return;
  }
  if (!(existing instanceof Y.Map) || existing.get("type") !== state.type) {
    const map = new Y.Map<unknown>();
    items.set(id, map);
    fillItemMap(map, state, true);
    return;
  }
  fillItemMap(existing, state, false);
}

/**
 * Bring the whole document in line with the live rows: add or update every
 * row, and remove items that no longer have one.
 */
export function replaceAllItemStates(
  doc: Y.Doc,
  rows: CanvasItemState[],
): void {
  const items = documentItems(doc);
  const live = new Set(rows.map((row) => row.id));
  for (const id of Array.from(items.keys())) {
    if (!live.has(id)) items.delete(id);
  }
  for (const row of rows) applyItemState(items, row.id, row);
}

/** Build a fresh document holding exactly `rows`, e.g. for a lazy migration. */
export function createDocumentFromRows(rows: CanvasItemState[]): Y.Doc {
  const doc = createCanvasYDoc();
  doc.transact(() => replaceAllItemStates(doc, rows));
  return doc;
}
