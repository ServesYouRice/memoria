/**
 * IMP-042 — the canvas items the board renders while a collaborative
 * document is open: the document's items inside the viewport window (the
 * same window, tag filter, order and limit the HTTP list applies), with row
 * metadata such as version and authorship from the HTTP list where the row
 * is already known. The document decides which items exist and what they
 * look like; rows catch up once the sync server has stored each change.
 *
 * @module lib/collaboration/sync/canvas-view
 */

import type { CanvasItem, ItemContent } from "@/types/canvas";
import type { CanvasItemState } from "./document-items";
import type { CanvasDocumentEntry } from "./client-session";

/** The viewport window of `calculateViewportWindow`. */
export interface CanvasItemWindow {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  limit?: number;
  tags?: string[];
}

interface CachedItem {
  base: CanvasItem | undefined;
  item: CanvasItem;
}

/**
 * Remembers the item built for each document entry, so unchanged items keep
 * their identity and memoized item components skip re-rendering.
 */
export type DocumentItemCache = WeakMap<CanvasDocumentEntry, CachedItem>;

export function createDocumentItemCache(): DocumentItemCache {
  return new WeakMap();
}

const EPOCH = new Date(0);

export function itemInWindow(
  state: CanvasItemState,
  window: CanvasItemWindow,
): boolean {
  return (
    state.positionX + state.width >= window.minX &&
    state.positionX <= window.maxX &&
    state.positionY + state.height >= window.minY &&
    state.positionY <= window.maxY &&
    (window.tags ?? []).every((tag) => state.tags.includes(tag))
  );
}

function compareEntries(
  left: CanvasDocumentEntry,
  right: CanvasDocumentEntry,
): number {
  if (left.state.zIndex !== right.state.zIndex)
    return left.state.zIndex - right.state.zIndex;
  if (left.state.id === right.state.id) return 0;
  return left.state.id < right.state.id ? -1 : 1;
}

export function overlayDocumentItems(input: {
  canvasId: string;
  entries: ReadonlyMap<string, CanvasDocumentEntry>;
  /** Items from the HTTP list, for row metadata. */
  queried: readonly CanvasItem[];
  window?: CanvasItemWindow;
  cache?: DocumentItemCache;
}): CanvasItem[] {
  const { canvasId, window, cache } = input;
  const queried = new Map(input.queried.map((item) => [item.id, item]));
  const visible: CanvasDocumentEntry[] = [];
  for (const entry of input.entries.values()) {
    if (!window || itemInWindow(entry.state, window)) visible.push(entry);
  }
  visible.sort(compareEntries);
  const limited =
    window?.limit !== undefined ? visible.slice(0, window.limit) : visible;

  return limited.map((entry) => {
    const base = queried.get(entry.state.id);
    const cached = cache?.get(entry);
    if (cached && cached.base === base) return cached.item;
    const { state } = entry;
    const item: CanvasItem = {
      ...(base ?? {
        canvasId,
        version: 1,
        deletedAt: null,
        createdById: "",
        updatedById: null,
        deletedById: null,
        createdAt: entry.changedAt ?? EPOCH,
      }),
      id: state.id,
      type: state.type,
      positionX: state.positionX,
      positionY: state.positionY,
      width: state.width,
      height: state.height,
      zIndex: state.zIndex,
      tags: state.tags,
      content: state.content as ItemContent,
      // A change seen in the document re-renders the item before its row
      // (and its version) catches up.
      updatedAt: entry.changedAt ?? base?.updatedAt ?? EPOCH,
    };
    cache?.set(entry, { base, item });
    return item;
  });
}
