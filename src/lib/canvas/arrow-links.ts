/**
 * Arrows as links (IMP-095). An ARROW item whose content names a live
 * `startItemId` and `endItemId` on its own canvas is the one record of "these
 * two items are linked". The database keeps the `ItemConnection` rows in step
 * with arrows inside every writing transaction (see the
 * `20261112140000_arrow_links` migration), so code reads links from
 * `ItemConnection` and writes them by creating, changing or deleting arrows.
 */

import { z } from "zod";
import {
  ItemType,
  type Prisma,
  type PrismaClient,
} from "@/generated/prisma/client";
import { createLogger } from "@/lib/logger";
import { lockCanvasForMutation } from "@/lib/canvas/mutation-lock";
import { recordCanvasItemEvent } from "@/lib/collaboration/committed-events";
import { invalidateCanvasCache } from "@/lib/cache/canvas-cache";
import { enqueueOutboxJobs } from "@/lib/outbox/enqueue";
import type { OutboxHandler } from "@/lib/outbox/types";
import { canvasItemRoom } from "@/lib/policy/capacity";
import { parseCanvasItemContent } from "@/lib/validation/canvas-item";
import { getItemTitle } from "@/lib/agents/item-text";

const logger = createLogger("arrow-links");

type Tx = Prisma.TransactionClient;

/** Longest link label people can give an arrow. */
export const LINK_LABEL_MAX = 100;

interface Box {
  positionX: number;
  positionY: number;
  width: number;
  height: number;
}

function center(box: Box) {
  return {
    x: box.positionX + box.width / 2,
    y: box.positionY + box.height / 2,
  };
}

/**
 * Geometry of a straight arrow from the centre of one item to the centre of
 * another: positioned at the start, with points relative to that position.
 */
export function arrowBetween(from: Box, to: Box) {
  const start = center(from);
  const end = center(to);
  return {
    positionX: start.x,
    positionY: start.y,
    width: Math.max(Math.abs(end.x - start.x), 1),
    height: Math.max(Math.abs(end.y - start.y), 1),
    startPoint: { x: 0, y: 0 },
    endPoint: { x: end.x - start.x, y: end.y - start.y },
  };
}

export const LINK_STYLES = ["SOLID", "DASHED", "DOTTED"] as const;
export type LinkStyle = (typeof LINK_STYLES)[number];

function isLinkStyle(value: unknown): value is LinkStyle {
  return LINK_STYLES.includes(value as LinkStyle);
}

export class LinkEndpointError extends Error {
  constructor() {
    super("Both items must be on this canvas, and not arrows.");
    this.name = "LinkEndpointError";
  }
}

/**
 * Link two items on a canvas by drawing an arrow between them. Call inside a
 * transaction that holds the canvas mutation lock; the caller invalidates
 * the canvas cache after commit. Returns the arrow and the link row the
 * database derived from it.
 */
export async function createLinkArrow(
  tx: Tx,
  input: {
    canvasId: string;
    actorId: string;
    fromId: string;
    toId: string;
    label?: string | null;
    style?: LinkStyle | string | null;
  },
) {
  if (input.fromId === input.toId) throw new LinkEndpointError();
  const endpoints = await tx.canvasItem.findMany({
    where: {
      id: { in: [input.fromId, input.toId] },
      canvasId: input.canvasId,
      deletedAt: null,
      type: { not: ItemType.ARROW },
    },
    select: {
      id: true,
      positionX: true,
      positionY: true,
      width: true,
      height: true,
      zIndex: true,
    },
  });
  const from = endpoints.find((item) => item.id === input.fromId);
  const to = endpoints.find((item) => item.id === input.toId);
  if (!from || !to) throw new LinkEndpointError();

  const geometry = arrowBetween(from, to);
  const label = input.label?.trim().slice(0, LINK_LABEL_MAX) || undefined;
  const content = parseCanvasItemContent(ItemType.ARROW, {
    startItemId: from.id,
    endItemId: to.id,
    startPoint: geometry.startPoint,
    endPoint: geometry.endPoint,
    arrowHeadStart: "none",
    arrowHeadEnd: "arrow",
    strokeWidth: 2,
    ...(label ? { label } : {}),
    ...(isLinkStyle(input.style) && input.style !== "SOLID"
      ? { lineStyle: input.style }
      : {}),
  });
  const arrow = await tx.canvasItem.create({
    data: {
      canvasId: input.canvasId,
      type: ItemType.ARROW,
      positionX: geometry.positionX,
      positionY: geometry.positionY,
      width: geometry.width,
      height: geometry.height,
      // Under both endpoints, so the line never covers them.
      zIndex: Math.max(0, Math.min(from.zIndex, to.zIndex) - 1),
      content: content as Prisma.InputJsonValue,
      createdById: input.actorId,
    },
  });
  await recordCanvasItemEvent(tx, {
    canvasId: input.canvasId,
    actorId: input.actorId,
    itemId: arrow.id,
    version: arrow.version,
    operation: "created",
  });
  const link = await tx.itemConnection.findUnique({
    where: {
      canvasId_fromId_toId: {
        canvasId: input.canvasId,
        fromId: from.id,
        toId: to.id,
      },
    },
  });
  return { arrow, link };
}

/** Live arrows on a canvas that back the link from `fromId` to `toId`. */
export async function arrowsForLink(
  tx: Tx | PrismaClient,
  link: { canvasId: string; fromId: string; toId: string },
) {
  return tx.canvasItem.findMany({
    where: {
      canvasId: link.canvasId,
      type: ItemType.ARROW,
      deletedAt: null,
      AND: [
        { content: { path: ["startItemId"], equals: link.fromId } },
        { content: { path: ["endItemId"], equals: link.toId } },
      ],
    },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  });
}

export const CANVAS_LINKS_BACKFILL_JOB = "canvas.links.backfill";
const BACKFILL_BATCH = 200;

/**
 * `canvas.links.backfill`: links made before IMP-095 without an arrow get
 * one (recorded as canvas events), so every link is drawn and arrows stay
 * the one source of truth. A link whose items are gone, trashed or on
 * another canvas, or whose canvas is full, is removed. Safe to run twice.
 */
export function createCanvasLinksBackfillHandler(
  prisma: PrismaClient,
): OutboxHandler {
  return async () => {
    const legacy = await prisma.$queryRaw<
      Array<{
        id: string;
        canvasId: string;
        fromId: string;
        toId: string;
        label: string | null;
        style: string;
      }>
    >`
      SELECT c."id", c."canvasId", c."fromId", c."toId", c."label", c."style"
      FROM "ItemConnection" c
      WHERE NOT EXISTS (
        SELECT 1 FROM "CanvasItem" a
        WHERE a."canvasId" = c."canvasId" AND a."type" = 'ARROW'
          AND a."deletedAt" IS NULL
          AND a."content"->>'startItemId' = c."fromId"
          AND a."content"->>'endItemId' = c."toId"
      )
      ORDER BY c."canvasId", c."id"
      LIMIT ${BACKFILL_BATCH}
    `;
    if (legacy.length === 0) return;

    const byCanvas = new Map<string, typeof legacy>();
    for (const row of legacy) {
      byCanvas.set(row.canvasId, [...(byCanvas.get(row.canvasId) ?? []), row]);
    }
    for (const [canvasId, rows] of byCanvas) {
      await prisma.$transaction(async (tx) => {
        await lockCanvasForMutation(tx, canvasId);
        const canvas = await tx.canvas.findUnique({
          where: { id: canvasId },
          select: { userId: true },
        });
        let room = canvas ? await canvasItemRoom(tx, canvasId) : 0;
        for (const row of rows) {
          const still = await tx.itemConnection.findUnique({
            where: { id: row.id },
          });
          if (!still) continue;
          if (canvas && room > 0) {
            try {
              await createLinkArrow(tx, {
                canvasId,
                actorId: canvas.userId,
                fromId: row.fromId,
                toId: row.toId,
                label: row.label,
                style: row.style,
              });
              room -= 1;
              continue;
            } catch (error) {
              if (!(error instanceof LinkEndpointError)) throw error;
            }
          }
          logger.info(
            { connectionId: row.id },
            "Removing a link that cannot be drawn as an arrow",
          );
          await tx.itemConnection.deleteMany({ where: { id: row.id } });
        }
      });
      await invalidateCanvasCache(canvasId);
    }

    if (legacy.length === BACKFILL_BATCH) {
      const last = legacy.at(-1)!.id;
      await enqueueOutboxJobs(prisma, [
        {
          type: CANVAS_LINKS_BACKFILL_JOB,
          payload: { after: last },
          dedupeKey: `${CANVAS_LINKS_BACKFILL_JOB}:${last}`,
        },
      ]);
    }
  };
}

export interface ItemLinkSummary {
  direction: "to" | "from";
  itemId: string;
  title: string;
  label: string | null;
}

/**
 * What each item is linked to, at most `perItem` each, for search results,
 * Ask and agents. Links never cross canvases, so the other end shares the
 * item's canvas and its access.
 */
export async function loadItemLinks(
  db: Tx | PrismaClient,
  itemIds: string[],
  perItem: number,
): Promise<Map<string, ItemLinkSummary[]>> {
  const result = new Map<string, ItemLinkSummary[]>();
  if (itemIds.length === 0) return result;
  const endpoint = { select: { id: true, type: true, content: true } } as const;
  const rows = await db.itemConnection.findMany({
    where: { OR: [{ fromId: { in: itemIds } }, { toId: { in: itemIds } }] },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    take: itemIds.length * perItem * 2,
    select: { label: true, fromItem: endpoint, toItem: endpoint },
  });
  const wanted = new Set(itemIds);
  const add = (id: string, link: ItemLinkSummary) => {
    const list = result.get(id) ?? [];
    if (list.length < perItem) list.push(link);
    result.set(id, list);
  };
  for (const row of rows) {
    if (wanted.has(row.fromItem.id)) {
      add(row.fromItem.id, {
        direction: "to",
        itemId: row.toItem.id,
        title: getItemTitle(row.toItem),
        label: row.label,
      });
    }
    if (wanted.has(row.toItem.id)) {
      add(row.toItem.id, {
        direction: "from",
        itemId: row.fromItem.id,
        title: getItemTitle(row.fromItem),
        label: row.label,
      });
    }
  }
  return result;
}

export const linkLabelSchema = z.string().trim().max(LINK_LABEL_MAX);
