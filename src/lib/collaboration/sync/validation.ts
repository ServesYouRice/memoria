/**
 * IMP-042 — server-side validation of decoded document updates.
 *
 * The sync server applies a client's update to a private replica of the
 * document, then inspects what the transaction changed. Every touched item is
 * checked against the same Zod schemas and limits the HTTP API enforces, and
 * the result is a list of row-shaped changes for projection. Anything outside
 * the document contract in `protocol.ts` rejects the whole update.
 *
 * @module lib/collaboration/sync/validation
 */

import * as Y from "yjs";
import { z } from "zod";
import { ItemType } from "@/types/canvas";
import { MAX_TAG_LENGTH, MAX_TAGS_PER_ITEM } from "@/lib/constants";
import {
  geometrySchema,
  parseCanvasItemContent,
} from "@/lib/validation/canvas-item";
import { LAUNCH_LIMITS } from "@/lib/policy/launch-limits";
import { requirePollsEnabled } from "@/lib/polls/availability";
import {
  ITEM_GEOMETRY_KEYS,
  ITEM_KEYS,
  NOTE_COLOR_KEY,
  NOTE_TEXT_KEY,
  TABLE_CELLS_KEY,
  isNewCanvasItemId,
  type ItemGeometryKey,
} from "./protocol";
import {
  type CanvasItemState,
  type ItemMap,
  isNoteTextFragment,
  jsonEqual,
  readTableCells,
} from "./document-items";
import {
  TABLE_MAX_CELL_CHARS,
  TABLE_MAX_COLUMNS,
  TABLE_MAX_ROWS,
  parseTableCellKey,
  tableStructureSchema,
} from "@/lib/tables/table-content";
import { readNoteFragment } from "./note-fragment";
import { DEFAULT_NOTE_COLOR } from "@/lib/note-colors";

export class InvalidDocumentUpdateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidDocumentUpdateError";
  }
}

function reject(message: string): never {
  throw new InvalidDocumentUpdateError(message);
}

export type ItemFieldChanges = Partial<
  Pick<CanvasItemState, ItemGeometryKey | "tags" | "content">
>;

export type DocumentItemChange =
  | { kind: "create"; state: CanvasItemState }
  | {
      kind: "update";
      id: string;
      type: ItemType;
      fields: ItemFieldChanges;
      /** The item map was replaced; project every field. */
      replaced: boolean;
    }
  | { kind: "delete"; id: string };

/** What one transaction touched, keyed by item id. */
export interface TouchedItems {
  ids: Set<string>;
  fields: Map<string, Set<string>>;
  noteText: Set<string>;
  /** IMP-108: items whose table cells changed. */
  tableCells: Set<string>;
}

const tagsSchema = z
  .array(z.string().min(1).max(MAX_TAG_LENGTH))
  .max(MAX_TAGS_PER_ITEM);
const ITEM_TYPES = new Set<string>(Object.values(ItemType));
export const MAX_ITEMS_PER_UPDATE = LAUNCH_LIMITS.itemsPerCanvas;

type AnyType = Y.AbstractType<unknown>;

/**
 * Map every type a transaction changed to the item it belongs to. Changes to
 * any root but `items`, array-style content in a map, or nested types outside
 * a note's text are refused.
 */
export function collectTouchedItems(
  transaction: Y.Transaction,
  items: Y.Map<ItemMap>,
): TouchedItems {
  const touched: TouchedItems = {
    ids: new Set(),
    fields: new Map(),
    noteText: new Set(),
    tableCells: new Set(),
  };
  const itemsType = items as unknown as AnyType;

  for (const [type, keys] of transaction.changed) {
    const changedType = type as AnyType;
    if (changedType === itemsType) {
      for (const key of keys) {
        if (key === null) reject("The item map only holds keyed items.");
        touched.ids.add(key);
      }
      continue;
    }

    // Walk up to the item map: its parent is the root `items` map.
    let child: AnyType = changedType;
    let path: AnyType[] = [];
    for (;;) {
      const item = child._item;
      if (!item) reject("Updates may only change canvas items.");
      const parent = item.parent as AnyType | null;
      if (!(parent instanceof Y.AbstractType))
        reject("Updates may only change canvas items.");
      if (parent === itemsType) break;
      path = [child, ...path];
      child = parent;
    }
    const itemId = child._item?.parentSub;
    if (!itemId) reject("The item map only holds keyed items.");
    touched.ids.add(itemId);

    if (changedType === child) {
      const fields = touched.fields.get(itemId) ?? new Set<string>();
      for (const key of keys) {
        if (key === null) reject("Canvas items only hold keyed fields.");
        fields.add(key);
      }
      touched.fields.set(itemId, fields);
      continue;
    }

    // A nested type inside an item: only note text and table cells (one
    // flat map of text) may hold one.
    const nestedKey = path[0]?._item?.parentSub;
    if (nestedKey === TABLE_CELLS_KEY) {
      if (path.length !== 1 || !(changedType instanceof Y.Map))
        reject("Table cells hold plain text only.");
      touched.tableCells.add(itemId);
      continue;
    }
    if (nestedKey !== NOTE_TEXT_KEY)
      reject("Only note text may hold nested content.");
    touched.noteText.add(itemId);
  }

  if (touched.ids.size > MAX_ITEMS_PER_UPDATE)
    reject("The update touches too many items.");
  return touched;
}

function readType(map: ItemMap): ItemType {
  const type = map.get("type");
  if (typeof type !== "string" || !ITEM_TYPES.has(type))
    reject("Unsupported item type.");
  try {
    requirePollsEnabled(type);
  } catch {
    reject("Polls are disabled.");
  }
  return type as ItemType;
}

function readGeometryField(map: ItemMap, key: ItemGeometryKey): number {
  const parsed = geometrySchema.shape[key].safeParse(map.get(key));
  if (!parsed.success) reject(`Invalid item ${key}.`);
  return parsed.data;
}

function readTags(map: ItemMap): string[] {
  const value = map.get("tags");
  if (value instanceof Y.AbstractType) reject("Tags must be a plain list.");
  const parsed = tagsSchema.safeParse(value);
  if (!parsed.success) reject("Invalid item tags.");
  return parsed.data;
}

/**
 * Non-note content must already be in the form the content schema produces,
 * so the row the server stores and the document every client sees agree.
 */
/**
 * IMP-108: a table keeps its structure in "content" (already normalized) and
 * each cell in the cells map. Cells must be text within the limit under a
 * well-formed key; cells of rows or columns removed at the same time by
 * someone else are allowed in the document and dropped from the row.
 */
function readTableItemContent(map: ItemMap): unknown {
  if (map.has(NOTE_TEXT_KEY)) reject("Only notes hold rich text.");
  if (map.has(NOTE_COLOR_KEY)) reject("Only notes have a note colour.");
  const structure = map.get("content");
  if (structure === undefined || structure instanceof Y.AbstractType)
    reject("Item content must be a plain value.");
  const parsed = tableStructureSchema.safeParse(structure);
  if (!parsed.success || !jsonEqual(parsed.data, structure))
    reject("Invalid table.");
  const cells = map.get(TABLE_CELLS_KEY);
  if (!(cells instanceof Y.Map)) reject("A table needs its cells.");
  if (cells.size > TABLE_MAX_ROWS * TABLE_MAX_COLUMNS)
    reject("The table has too many cells.");
  cells.forEach((value, key) => {
    if (
      typeof value !== "string" ||
      value.length > TABLE_MAX_CELL_CHARS ||
      !parseTableCellKey(key)
    )
      reject("Invalid table cell.");
  });
  try {
    return parseCanvasItemContent(ItemType.TABLE, {
      ...parsed.data,
      cells: readTableCells(cells),
    });
  } catch {
    reject("Invalid table.");
  }
}

function readContent(map: ItemMap, type: ItemType): unknown {
  if (type === ItemType.TABLE) return readTableItemContent(map);
  if (map.has(TABLE_CELLS_KEY)) reject("Only tables hold cells.");
  if (map.has(NOTE_TEXT_KEY)) reject("Only notes hold rich text.");
  if (map.has(NOTE_COLOR_KEY)) reject("Only notes have a note colour.");
  const value = map.get("content");
  if (value === undefined || value instanceof Y.AbstractType)
    reject("Item content must be a plain value.");
  let parsed: unknown;
  try {
    parsed = parseCanvasItemContent(type, value);
  } catch {
    reject("Invalid item content.");
  }
  if (!jsonEqual(parsed, value)) reject("Item content is not normalized.");
  return parsed;
}

function readNoteContent(map: ItemMap): unknown {
  if (map.has("content")) reject("Notes keep their content as rich text.");
  if (map.has(TABLE_CELLS_KEY)) reject("Only tables hold cells.");
  const fragment = map.get(NOTE_TEXT_KEY);
  if (!isNoteTextFragment(fragment)) reject("Notes need rich text.");
  // Only the stored form: a listed colour other than the default yellow.
  const color = map.get(NOTE_COLOR_KEY);
  if (
    map.has(NOTE_COLOR_KEY) &&
    (typeof color !== "string" || color === DEFAULT_NOTE_COLOR)
  )
    reject("Invalid note colour.");
  try {
    return readNoteFragment(fragment, color);
  } catch (error) {
    reject(error instanceof Error ? error.message : "Invalid note text.");
  }
}

function assertKnownKeys(map: ItemMap): void {
  for (const key of map.keys()) {
    if (!ITEM_KEYS.has(key)) reject(`Unsupported item field: ${key}.`);
  }
}

/** Validate a whole item, as for a creation. */
export function readValidatedItem(id: string, map: unknown): CanvasItemState {
  if (!(map instanceof Y.Map)) reject("Canvas items must be maps.");
  const itemMap = map as ItemMap;
  assertKnownKeys(itemMap);
  const type = readType(itemMap);
  const [positionX, positionY, width, height, zIndex] = ITEM_GEOMETRY_KEYS.map(
    (key) => readGeometryField(itemMap, key),
  );
  return {
    id,
    type,
    positionX,
    positionY,
    width,
    height,
    zIndex,
    tags: readTags(itemMap),
    content:
      type === ItemType.NOTE
        ? readNoteContent(itemMap)
        : readContent(itemMap, type),
  };
}

function sameStruct(left: AnyType, right: AnyType): boolean {
  const leftId = left._item?.id;
  const rightId = right._item?.id;
  return Boolean(
    leftId &&
    rightId &&
    leftId.client === rightId.client &&
    leftId.clock === rightId.clock,
  );
}

/**
 * Turn the touched items into row changes, validating each against the state
 * after the update (`after`) and the accepted state before it (`before`).
 */
export function validateTouchedItems(
  touched: TouchedItems,
  before: Y.Map<ItemMap>,
  after: Y.Map<ItemMap>,
): DocumentItemChange[] {
  const changes: DocumentItemChange[] = [];

  for (const id of touched.ids) {
    const previous = before.get(id) as unknown;
    const current = after.get(id) as unknown;

    if (current === undefined) {
      if (previous !== undefined) changes.push({ kind: "delete", id });
      continue;
    }
    if (!(current instanceof Y.Map)) reject("Canvas items must be maps.");

    if (previous === undefined) {
      if (!isNewCanvasItemId(id)) reject("Invalid item id.");
      changes.push({ kind: "create", state: readValidatedItem(id, current) });
      continue;
    }
    if (!(previous instanceof Y.Map)) reject("Canvas items must be maps.");
    const previousType = previous.get("type");

    if (!sameStruct(previous as AnyType, current as AnyType)) {
      // The whole item map was replaced under the same id.
      const state = readValidatedItem(id, current);
      if (state.type !== previousType) reject("Item type cannot change.");
      const { id: _id, type, ...fields } = state;
      changes.push({ kind: "update", id, type, fields, replaced: true });
      continue;
    }

    const map = current as ItemMap;
    const type = readType(map);
    if (type !== previousType) reject("Item type cannot change.");
    const fields: ItemFieldChanges = {};
    for (const key of touched.fields.get(id) ?? []) {
      if (!ITEM_KEYS.has(key)) reject(`Unsupported item field: ${key}.`);
      if (key === "type") continue;
      if ((ITEM_GEOMETRY_KEYS as readonly string[]).includes(key)) {
        fields[key as ItemGeometryKey] = readGeometryField(
          map,
          key as ItemGeometryKey,
        );
      } else if (key === "tags") {
        fields.tags = readTags(map);
      } else if (type === ItemType.NOTE) {
        fields.content = readNoteContent(map);
      } else {
        fields.content = readContent(map, type);
      }
    }
    if (touched.noteText.has(id)) {
      if (type !== ItemType.NOTE) reject("Only notes hold rich text.");
      fields.content = readNoteContent(map);
    }
    if (touched.tableCells.has(id)) {
      if (type !== ItemType.TABLE) reject("Only tables hold cells.");
      fields.content = readContent(map, type);
    }
    if (Object.keys(fields).length > 0)
      changes.push({ kind: "update", id, type, fields, replaced: false });
  }

  return changes;
}
