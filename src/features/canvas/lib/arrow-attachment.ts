/**
 * Arrows that attach to items (IMP-095). An arrow whose content names a
 * `startItemId` and `endItemId` links the two items; it is drawn from edge to
 * edge of the items wherever they are now, so it follows them when they move.
 * The database derives the link from the arrow, so the editor only writes the
 * arrow.
 */

import { ItemType, type ArrowContent, type CanvasItem } from "@/types/canvas";

export type Point = { x: number; y: number };

interface Box {
  positionX: number;
  positionY: number;
  width: number;
  height: number;
}

/** Item types an arrow can attach to: everything but arrows and strokes. */
export function canAttachArrowTo(item: Pick<CanvasItem, "type">) {
  return item.type !== ItemType.ARROW && item.type !== ItemType.DRAWING;
}

function contains(box: Box, point: Point) {
  return (
    point.x >= box.positionX &&
    point.x <= box.positionX + box.width &&
    point.y >= box.positionY &&
    point.y <= box.positionY + box.height
  );
}

/** The topmost item an arrow end dropped at `point` attaches to. */
export function attachableItemAt(
  items: readonly CanvasItem[],
  point: Point,
): CanvasItem | null {
  let best: CanvasItem | null = null;
  for (const item of items) {
    if (!canAttachArrowTo(item) || !contains(item, point)) continue;
    // Frames sit behind their contents, so a frame wins only when alone.
    const rank = (candidate: CanvasItem) =>
      (candidate.type === ItemType.FRAME ? -1e9 : 0) + candidate.zIndex;
    if (!best || rank(item) >= rank(best)) best = item;
  }
  return best;
}

function center(box: Box): Point {
  return {
    x: box.positionX + box.width / 2,
    y: box.positionY + box.height / 2,
  };
}

/** Where the line from the box centre towards `toward` leaves the box. */
export function boxExit(box: Box, toward: Point): Point {
  const c = center(box);
  const dx = toward.x - c.x;
  const dy = toward.y - c.y;
  if (dx === 0 && dy === 0) return c;
  const halfW = box.width / 2;
  const halfH = box.height / 2;
  const scale = Math.min(
    dx === 0 ? Infinity : halfW / Math.abs(dx),
    dy === 0 ? Infinity : halfH / Math.abs(dy),
  );
  if (scale >= 1) return c; // `toward` is inside the box
  return { x: c.x + dx * scale, y: c.y + dy * scale };
}

/**
 * The arrow's two ends in canvas space: an attached end sits on the edge of
 * its item (where it is now), a free end where it was drawn.
 */
export function arrowEnds(
  arrow: Pick<CanvasItem, "positionX" | "positionY" | "content">,
  itemsById: ReadonlyMap<string, CanvasItem>,
): { start: Point; end: Point } {
  const content = arrow.content as ArrowContent;
  const startItem = content.startItemId
    ? itemsById.get(content.startItemId)
    : undefined;
  const endItem = content.endItemId
    ? itemsById.get(content.endItemId)
    : undefined;
  const at = (point: Point | undefined, fallback: Point) =>
    point
      ? { x: arrow.positionX + point.x, y: arrow.positionY + point.y }
      : fallback;
  const freeStart = at(content.startPoint, {
    x: arrow.positionX,
    y: arrow.positionY,
  });
  const freeEnd = at(content.endPoint, {
    x: arrow.positionX + 100,
    y: arrow.positionY + 100,
  });
  const startAim = startItem ? center(startItem) : freeStart;
  const endAim = endItem ? center(endItem) : freeEnd;
  return {
    start: startItem ? boxExit(startItem, endAim) : freeStart,
    end: endItem ? boxExit(endItem, startAim) : freeEnd,
  };
}

/** Arrow item geometry for two ends in canvas space. */
export function arrowGeometry(start: Point, end: Point) {
  const positionX = Math.min(start.x, end.x);
  const positionY = Math.min(start.y, end.y);
  return {
    positionX,
    positionY,
    width: Math.max(Math.abs(end.x - start.x), 1),
    height: Math.max(Math.abs(end.y - start.y), 1),
    startPoint: { x: start.x - positionX, y: start.y - positionY },
    endPoint: { x: end.x - positionX, y: end.y - positionY },
  };
}

/** True when the arrow links two items. */
export function isLinkArrow(item: CanvasItem) {
  if (item.type !== ItemType.ARROW) return false;
  const content = item.content as ArrowContent;
  return Boolean(
    content.startItemId &&
    content.endItemId &&
    content.startItemId !== content.endItemId,
  );
}

/**
 * Content and geometry for an arrow whose `which` end was dropped at
 * `point`: on an item it attaches there, on empty canvas it comes free. An
 * arrow never attaches both ends to the same item.
 */
export function moveArrowEnd(
  arrow: CanvasItem,
  which: "start" | "end",
  point: Point,
  items: readonly CanvasItem[],
) {
  const itemsById = new Map(items.map((item) => [item.id, item]));
  const content = arrow.content as ArrowContent;
  const ends = arrowEnds(arrow, itemsById);
  const otherId = which === "start" ? content.endItemId : content.startItemId;
  const target = attachableItemAt(
    items.filter((item) => item.id !== arrow.id),
    point,
  );
  const attachId = target && target.id !== otherId ? target.id : undefined;

  const next: ArrowContent = { ...content };
  if (which === "start") {
    next.startItemId = attachId;
    ends.start = point;
  } else {
    next.endItemId = attachId;
    ends.end = point;
  }
  if (!next.startItemId) delete next.startItemId;
  if (!next.endItemId) delete next.endItemId;
  const free = arrowGeometry(ends.start, ends.end);
  const resolved = arrowEnds(
    {
      positionX: free.positionX,
      positionY: free.positionY,
      content: {
        ...next,
        startPoint: free.startPoint,
        endPoint: free.endPoint,
      },
    },
    itemsById,
  );
  const geometry = arrowGeometry(resolved.start, resolved.end);
  return {
    positionX: geometry.positionX,
    positionY: geometry.positionY,
    width: geometry.width,
    height: geometry.height,
    content: {
      ...next,
      startPoint: geometry.startPoint,
      endPoint: geometry.endPoint,
    } satisfies ArrowContent,
  };
}

/**
 * A freshly drawn arrow: each end that lands on an item attaches to it, and
 * an arrow with both ends on the same item stays free.
 */
export function drawnArrow(
  start: Point,
  end: Point,
  items: readonly CanvasItem[],
) {
  const from = attachableItemAt(items, start);
  const to = attachableItemAt(items, end);
  const sameItem = from && to && from.id === to.id;
  const startItem = sameItem ? null : from;
  const endItem = sameItem ? null : to;
  const itemsById = new Map(items.map((item) => [item.id, item]));
  const content: ArrowContent = {
    ...(startItem ? { startItemId: startItem.id } : {}),
    ...(endItem ? { endItemId: endItem.id } : {}),
  };
  const ends = arrowEnds(
    {
      ...arrowGeometry(start, end),
      content: { ...content, ...relative(start, end) },
    },
    itemsById,
  );
  const geometry = arrowGeometry(ends.start, ends.end);
  const attached = [startItem, endItem].filter(Boolean) as CanvasItem[];
  return {
    ...geometry,
    content,
    // A linking arrow sits under the items it links.
    zIndex:
      attached.length > 0
        ? Math.max(0, Math.min(...attached.map((item) => item.zIndex)) - 1)
        : undefined,
    length: Math.hypot(end.x - start.x, end.y - start.y),
  };
}

function relative(start: Point, end: Point) {
  const geometry = arrowGeometry(start, end);
  return { startPoint: geometry.startPoint, endPoint: geometry.endPoint };
}

export interface ItemLink {
  arrowId: string;
  direction: "to" | "from";
  item: CanvasItem;
  label?: string;
}

/** What `itemId` is linked to on this canvas, read from the arrows. */
export function linksOf(
  itemId: string,
  items: readonly CanvasItem[],
): ItemLink[] {
  const byId = new Map(items.map((item) => [item.id, item]));
  const links: ItemLink[] = [];
  for (const arrow of items) {
    if (!isLinkArrow(arrow)) continue;
    const content = arrow.content as ArrowContent;
    const otherId =
      content.startItemId === itemId
        ? content.endItemId
        : content.endItemId === itemId
          ? content.startItemId
          : undefined;
    const other = otherId ? byId.get(otherId) : undefined;
    if (!other || !canAttachArrowTo(other)) continue;
    links.push({
      arrowId: arrow.id,
      direction: content.startItemId === itemId ? "to" : "from",
      item: other,
      ...(content.label ? { label: content.label } : {}),
    });
  }
  return links;
}

/** Every link on a canvas, one per item pair, read from the arrows. */
export function canvasLinks(items: readonly CanvasItem[]) {
  const byId = new Map(items.map((item) => [item.id, item]));
  const seen = new Set<string>();
  const links: Array<{
    fromId: string;
    toId: string;
    label?: string;
    style: NonNullable<ArrowContent["lineStyle"]>;
  }> = [];
  for (const arrow of items) {
    if (!isLinkArrow(arrow)) continue;
    const content = arrow.content as ArrowContent;
    const from = byId.get(content.startItemId!);
    const to = byId.get(content.endItemId!);
    if (!from || !to || !canAttachArrowTo(from) || !canAttachArrowTo(to)) {
      continue;
    }
    const key = `${from.id}>${to.id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    links.push({
      fromId: from.id,
      toId: to.id,
      ...(content.label ? { label: content.label } : {}),
      style: content.lineStyle ?? "SOLID",
    });
  }
  return links;
}
