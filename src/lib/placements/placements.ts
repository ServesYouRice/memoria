/**
 * IMP-109: one item on several canvases.
 *
 * The item keeps its content and its home canvas. A placement says only
 * where the item sits on another canvas. Only the owner of the item's home
 * canvas can place it, and only onto other canvases they own. Anyone who can
 * see a canvas sees the items placed on it, read-only there; the item is
 * edited on its home canvas. Each placement counts toward that canvas's item
 * limit. Trashing the item hides its placements and restoring it brings them
 * back; deleting it for good deletes them.
 *
 * When a placed item changes, the canvases it is placed on get a
 * "placement-changed" notice on their live channel and read their
 * placements again.
 */
import { z } from "zod";
import type { Prisma, PrismaClient } from "@/generated/prisma/client";
import { getRedisClient } from "@/lib/cache/redis-client";
import { canvasChannel } from "@/lib/collaboration/channels";
import {
  ConflictError,
  ForbiddenError,
  UnprocessableEntityError,
  notFoundError,
} from "@/lib/errors";
import { createLogger } from "@/lib/logger";
import { assertCanvasItemCapacity } from "@/lib/policy/capacity";
import {
  PLACEMENT_CHANGED,
  isPlaceableType,
  type ItemPlacementSummary,
  type PlacedItem,
} from "./shared";

export type { ItemPlacementSummary, PlacedItem } from "./shared";
export { isPlaceableType } from "./shared";

type Store = Prisma.TransactionClient | PrismaClient;

const logger = createLogger("placements");

export const createPlacementSchema = z
  .object({ canvasId: z.string().cuid() })
  .strict();

const coordinate = z.number().finite().min(-1_000_000).max(1_000_000);
const size = z.number().finite().min(1).max(100_000);

export const updatePlacementSchema = z
  .object({
    positionX: coordinate.optional(),
    positionY: coordinate.optional(),
    width: size.optional(),
    height: size.optional(),
    zIndex: z.number().int().min(-1_000_000).max(1_000_000).optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, {
    message: "Nothing to change.",
  });

/**
 * Where the owner's item is shown besides its home canvas. Only the owner of
 * the home canvas may ask: the names are of their own canvases.
 */
export async function listItemPlacements(
  store: Store,
  input: { itemId: string; userId: string },
): Promise<{ homeCanvasId: string; placements: ItemPlacementSummary[] }> {
  const item = await store.canvasItem.findFirst({
    where: { id: input.itemId, deletedAt: null },
    select: { canvasId: true, canvas: { select: { userId: true } } },
  });
  if (!item) throw notFoundError("Item", input.itemId);
  if (item.canvas.userId !== input.userId)
    throw new ForbiddenError(
      "Only the canvas owner can see where it is shown.",
    );
  const placements = await store.itemPlacement.findMany({
    where: { itemId: input.itemId, canvasId: { not: item.canvasId } },
    select: { id: true, canvasId: true, canvas: { select: { name: true } } },
    orderBy: { createdAt: "asc" },
  });
  return {
    homeCanvasId: item.canvasId,
    placements: placements.map((placement) => ({
      id: placement.id,
      canvasId: placement.canvasId,
      canvasName: placement.canvas.name,
    })),
  };
}

/**
 * Show the item on another canvas of the same owner. The new placement sits
 * where the item sits on its home canvas.
 */
export async function createPlacement(
  store: PrismaClient,
  input: { itemId: string; canvasId: string; userId: string },
): Promise<ItemPlacementSummary> {
  return store.$transaction(async (tx) => {
    const item = await tx.canvasItem.findFirst({
      where: { id: input.itemId, deletedAt: null },
      select: {
        canvasId: true,
        type: true,
        positionX: true,
        positionY: true,
        width: true,
        height: true,
        canvas: { select: { userId: true } },
      },
    });
    if (!item) throw notFoundError("Item", input.itemId);
    if (item.canvas.userId !== input.userId)
      throw new ForbiddenError(
        "Only the canvas owner can show an item on another canvas.",
      );
    if (!isPlaceableType(item.type))
      throw new UnprocessableEntityError(
        "Arrows, frames and polls stay on their own canvas.",
      );
    if (item.canvasId === input.canvasId)
      throw new UnprocessableEntityError("The item is already on this canvas.");
    const target = await tx.canvas.findUnique({
      where: { id: input.canvasId },
      select: { userId: true, name: true },
    });
    // Another person's canvas reads as missing, like any canvas you cannot see.
    if (!target || target.userId !== input.userId)
      throw notFoundError("Canvas", input.canvasId);
    const existing = await tx.itemPlacement.findUnique({
      where: {
        itemId_canvasId: { itemId: input.itemId, canvasId: input.canvasId },
      },
      select: { id: true },
    });
    if (existing)
      throw new ConflictError("The item is already shown on that canvas.");
    await assertCanvasItemCapacity(tx, input.canvasId);
    const top = await tx.canvasItem.aggregate({
      where: { canvasId: input.canvasId, deletedAt: null },
      _max: { zIndex: true },
    });
    const placement = await tx.itemPlacement.create({
      data: {
        itemId: input.itemId,
        canvasId: input.canvasId,
        positionX: item.positionX,
        positionY: item.positionY,
        width: item.width,
        height: item.height,
        zIndex: (top._max.zIndex ?? 0) + 1,
        createdById: input.userId,
      },
      select: { id: true, canvasId: true },
    });
    return { ...placement, canvasName: target.name };
  });
}

/** A placement on this canvas, or a not-found error. */
async function placementOn(
  store: Store,
  canvasId: string,
  placementId: string,
) {
  const placement = await store.itemPlacement.findFirst({
    where: { id: placementId, canvasId },
    select: { id: true, itemId: true },
  });
  if (!placement) throw notFoundError("Placement", placementId);
  return placement;
}

export async function updatePlacement(
  store: Store,
  input: {
    canvasId: string;
    placementId: string;
    data: z.infer<typeof updatePlacementSchema>;
  },
) {
  await placementOn(store, input.canvasId, input.placementId);
  return store.itemPlacement.update({
    where: { id: input.placementId },
    data: input.data,
    select: {
      id: true,
      positionX: true,
      positionY: true,
      width: true,
      height: true,
      zIndex: true,
    },
  });
}

/** Take the item off this canvas; its home canvas and other places keep it. */
export async function deletePlacement(
  store: Store,
  input: { canvasId: string; placementId: string },
) {
  const placement = await placementOn(store, input.canvasId, input.placementId);
  await store.itemPlacement.delete({ where: { id: placement.id } });
  return placement;
}

/**
 * The live items placed on a canvas, for anyone who may view it. The home
 * canvas is named only to readers who may open it (`canOpen`).
 */
export async function listCanvasPlacements(
  store: Store,
  canvasId: string,
  canOpen: (homeCanvasId: string) => Promise<boolean>,
): Promise<PlacedItem[]> {
  const placements = await store.itemPlacement.findMany({
    where: { canvasId, item: { deletedAt: null } },
    orderBy: [{ zIndex: "asc" }, { id: "asc" }],
    select: {
      id: true,
      positionX: true,
      positionY: true,
      width: true,
      height: true,
      zIndex: true,
      item: {
        select: {
          id: true,
          canvasId: true,
          type: true,
          content: true,
          tags: true,
          version: true,
          createdAt: true,
          updatedAt: true,
          canvas: { select: { name: true } },
        },
      },
    },
  });
  const openable = new Map<string, boolean>();
  const result: PlacedItem[] = [];
  for (const placement of placements) {
    const { item } = placement;
    // An item moved onto this canvas meanwhile is shown once, as itself.
    if (item.canvasId === canvasId) continue;
    if (!openable.has(item.canvasId))
      openable.set(item.canvasId, await canOpen(item.canvasId));
    result.push({
      placementId: placement.id,
      homeCanvasId: item.canvasId,
      homeCanvasName: openable.get(item.canvasId) ? item.canvas.name : null,
      item: {
        id: item.id,
        type: item.type,
        content: item.content,
        tags: item.tags,
        version: item.version,
        positionX: placement.positionX,
        positionY: placement.positionY,
        width: placement.width,
        height: placement.height,
        zIndex: placement.zIndex,
        createdAt: item.createdAt.toISOString(),
        updatedAt: item.updatedAt.toISOString(),
      },
    });
  }
  return result;
}

/**
 * For deleting items on their home canvas: where else each will disappear.
 * Canvas names are given to the owner only; others learn how many.
 */
export async function placementsElsewhere(
  store: Store,
  input: { canvasId: string; itemIds: string[]; isOwner: boolean },
): Promise<Record<string, { count: number; canvasNames: string[] }>> {
  if (input.itemIds.length === 0) return {};
  const placements = await store.itemPlacement.findMany({
    where: {
      itemId: { in: input.itemIds },
      item: { canvasId: input.canvasId },
      canvasId: { not: input.canvasId },
    },
    select: { itemId: true, canvas: { select: { name: true } } },
    orderBy: { createdAt: "asc" },
  });
  const result: Record<string, { count: number; canvasNames: string[] }> = {};
  for (const placement of placements) {
    const entry = (result[placement.itemId] ??= { count: 0, canvasNames: [] });
    entry.count += 1;
    if (input.isOwner) entry.canvasNames.push(placement.canvas.name);
  }
  return result;
}

/**
 * Tell the canvases an item is placed on that it changed. Carries no
 * content: each canvas reads it again through the authorized route. Safe to
 * send twice; best effort, a canvas also reads again when it reconnects.
 */
export async function publishPlacementChanged(
  canvasIds: Iterable<string>,
  itemId: string,
  publish: (channel: string, message: string) => Promise<unknown> = async (
    channel,
    message,
  ) => getRedisClient()?.publish(channel, message),
): Promise<void> {
  for (const canvasId of new Set(canvasIds)) {
    try {
      await publish(
        canvasChannel(canvasId),
        JSON.stringify({
          type: "message",
          canvasId,
          instanceId: `placement:${itemId}:${Date.now()}`,
          payload: { type: PLACEMENT_CHANGED, itemId },
          timestamp: Date.now(),
        }),
      );
    } catch (error) {
      logger.warn(
        { error, canvasId },
        "Placement change notice was not published",
      );
    }
  }
}

/** The canvases besides its home that show this item. */
export async function placementCanvasIds(
  store: Store,
  itemId: string,
): Promise<string[]> {
  const rows = await store.itemPlacement.findMany({
    where: { itemId },
    select: { canvasId: true },
  });
  return rows.map((row) => row.canvasId);
}
