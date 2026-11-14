/** IMP-109: client-safe shapes for items shown on several canvases. */

import { ItemType, type CanvasItem, type ItemContent } from "@/types/canvas";

/** Item types that make sense away from their canvas. */
const PLACEABLE_TYPES = new Set<string>([
  ItemType.NOTE,
  ItemType.BOOKMARK,
  ItemType.IMAGE,
  ItemType.TEXT,
  ItemType.EMBED,
  ItemType.SHAPE,
  ItemType.DRAWING,
  ItemType.TABLE,
]);

export function isPlaceableType(type: string): boolean {
  return PLACEABLE_TYPES.has(type);
}

/** The live notice a canvas receives when a placed item changes. */
export const PLACEMENT_CHANGED = "placement-changed";

export function isPlacementChangedMessage(
  payload: unknown,
): payload is { type: typeof PLACEMENT_CHANGED; itemId: string } {
  return (
    !!payload &&
    typeof payload === "object" &&
    (payload as { type?: unknown }).type === PLACEMENT_CHANGED &&
    typeof (payload as { itemId?: unknown }).itemId === "string"
  );
}

/** An item placed on this canvas, with the geometry it has here. */
export interface PlacedItem {
  placementId: string;
  homeCanvasId: string;
  /** Null when the reader may not open the home canvas. */
  homeCanvasName: string | null;
  item: {
    id: string;
    type: string;
    content: unknown;
    tags: string[];
    version: number;
    positionX: number;
    positionY: number;
    width: number;
    height: number;
    zIndex: number;
    createdAt: string;
    updatedAt: string;
  };
}

/** A canvas this item also shows on, as its owner sees it. */
export interface ItemPlacementSummary {
  id: string;
  canvasId: string;
  canvasName: string;
}

/** A placed item drawn as a normal canvas item, with its geometry here. */
export function placedAsCanvasItem(
  placed: PlacedItem,
  canvasId: string,
): CanvasItem {
  const { item } = placed;
  return {
    id: item.id,
    canvasId,
    type: item.type as ItemType,
    positionX: item.positionX,
    positionY: item.positionY,
    width: item.width,
    height: item.height,
    zIndex: item.zIndex,
    content: item.content as ItemContent,
    tags: item.tags,
    version: item.version,
    deletedAt: null,
    createdById: "",
    updatedById: null,
    deletedById: null,
    createdAt: new Date(item.createdAt),
    updatedAt: new Date(item.updatedAt),
  };
}
