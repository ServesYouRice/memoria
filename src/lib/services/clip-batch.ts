/**
 * Clip batches: many links saved to the Inbox in one request.
 *
 * Used by the browser extension's "save all tabs" (IMP-061) and the phone
 * share target (IMP-062). A batch is all-or-nothing: the items, their
 * committed events and the batch record are written in one transaction, and a
 * retry with the same idempotency key returns the first result instead of
 * creating the links again. The optional sorting note is kept on the batch for
 * the Inbox sorter (IMP-063).
 */

import { createHash } from "crypto";
import {
  ClipBatchSource,
  ItemType,
  type Prisma,
} from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { ConflictError } from "@/lib/errors";
import { invalidateCanvasCache } from "@/lib/cache/canvas-cache";
import { lockCanvasForMutation } from "@/lib/canvas/mutation-lock";
import { recordCanvasItemEventsBatch } from "@/lib/collaboration/committed-events";
import {
  assertCanvasCapacity,
  assertCanvasItemCapacity,
} from "@/lib/policy/capacity";
import { findOpenSlot, INBOX_CANVAS_NAME } from "@/lib/agents/inbox";
import { parseCanvasItemContent } from "@/lib/validation/canvas-item";
import {
  clipBatchSchema,
  type ClipBatchInput,
} from "@/lib/validation/extension";

export { ClipBatchSource };

const LINK_SIZE = { width: 360, height: 120 };

export interface ClipBatchResult {
  batchId: string;
  canvasId: string;
  /** Created item ids, in the order the links were sent. */
  itemIds: string[];
  /** True when this call replayed an earlier batch with the same key. */
  replayed: boolean;
}

function hashBatch(input: ClipBatchInput) {
  return createHash("sha256")
    .update(JSON.stringify({ links: input.links, note: input.note ?? null }))
    .digest("hex");
}

async function lockBatchKey(
  tx: Prisma.TransactionClient,
  userId: string,
  idempotencyKey: string,
) {
  // Serialize concurrent sends of the same batch so the second one waits and
  // then replays, instead of failing on the unique index.
  await tx.$queryRaw`
    SELECT 1 AS "locked"
    FROM (SELECT pg_advisory_xact_lock(hashtext('clip-batch'), hashtext(${`${userId}:${idempotencyKey}`}))) AS acquired
  `;
}

async function findOrCreateInbox(tx: Prisma.TransactionClient, userId: string) {
  const find = () =>
    tx.canvas.findFirst({
      where: { userId, name: INBOX_CANVAS_NAME },
      orderBy: { createdAt: "asc" },
      select: { id: true },
    });
  const existing = await find();
  if (existing) return existing.id;

  // The capacity check takes the per-user canvas lock, so a concurrent batch
  // that created the Inbox meanwhile is visible on the second look.
  await assertCanvasCapacity(tx, userId);
  const raced = await find();
  if (raced) return raced.id;

  const created = await tx.canvas.create({
    data: { userId, name: INBOX_CANVAS_NAME },
    select: { id: true },
  });
  return created.id;
}

/**
 * Save a batch of links to the user's Inbox board (creating the board if it
 * does not exist yet). Throws a 409 when the idempotency key was already used
 * for a different batch, and a 422 when the Inbox has no room for every link.
 */
export async function saveClipBatch(input: {
  userId: string;
  source: ClipBatchSource;
  data: unknown;
}): Promise<ClipBatchResult> {
  const data = clipBatchSchema.parse(input.data);
  const { userId } = input;
  const requestHash = hashBatch(data);

  const result = await prisma.$transaction(async (tx) => {
    await lockBatchKey(tx, userId, data.idempotencyKey);

    const previous = await tx.clipBatch.findUnique({
      where: {
        userId_idempotencyKey: {
          userId,
          idempotencyKey: data.idempotencyKey,
        },
      },
      select: {
        id: true,
        canvasId: true,
        requestHash: true,
        items: { select: { itemId: true }, orderBy: { position: "asc" } },
      },
    });
    if (previous) {
      if (previous.requestHash !== requestHash) {
        throw new ConflictError(
          "This idempotency key was already used for a different batch.",
        );
      }
      return {
        batchId: previous.id,
        canvasId: previous.canvasId,
        itemIds: previous.items.map((item) => item.itemId),
        replayed: true,
      };
    }

    const canvasId = await findOrCreateInbox(tx, userId);
    await lockCanvasForMutation(tx, canvasId);
    await assertCanvasItemCapacity(tx, canvasId, data.links.length);

    const occupied = await tx.canvasItem.findMany({
      where: { canvasId, deletedAt: null },
      select: { positionX: true, positionY: true, width: true, height: true },
    });
    const rows = data.links.map((link) => {
      const slot = findOpenSlot(occupied, LINK_SIZE);
      const rect = { positionX: slot.x, positionY: slot.y, ...LINK_SIZE };
      occupied.push(rect);
      const content = parseCanvasItemContent(ItemType.BOOKMARK, {
        url: link.url,
        title: link.title || link.url,
      });
      return {
        canvasId,
        type: ItemType.BOOKMARK,
        ...rect,
        zIndex: 1,
        content: content as Prisma.InputJsonValue,
        createdById: userId,
        updatedById: userId,
      };
    });

    // INSERT ... RETURNING gives rows back in input order.
    const items = await tx.canvasItem.createManyAndReturn({
      data: rows,
      select: { id: true, version: true },
    });
    const batch = await tx.clipBatch.create({
      data: {
        userId,
        canvasId,
        source: input.source,
        idempotencyKey: data.idempotencyKey,
        requestHash,
        note: data.note ?? null,
        items: {
          createMany: {
            data: items.map((item, position) => ({
              itemId: item.id,
              position,
            })),
          },
        },
      },
      select: { id: true },
    });
    await recordCanvasItemEventsBatch(
      tx,
      items.map((item) => ({
        canvasId,
        actorId: userId,
        itemId: item.id,
        version: item.version,
        operation: "created" as const,
      })),
    );

    return {
      batchId: batch.id,
      canvasId,
      itemIds: items.map((item) => item.id),
      replayed: false,
    };
  });

  if (!result.replayed) {
    await invalidateCanvasCache(result.canvasId);
  }
  return result;
}

export interface ClipBatchNote {
  batchId: string;
  note: string;
  source: ClipBatchSource;
  createdAt: Date;
  /** Items the batch created that still exist, in the order they were sent. */
  itemIds: string[];
}

/**
 * The most recent non-empty sorting note saved with a batch on this canvas,
 * for the Inbox sorter (IMP-063). Pass `userId` to only consider batches that
 * user sent.
 */
export async function getLatestClipBatchNote(
  canvasId: string,
  options: { userId?: string } = {},
): Promise<ClipBatchNote | null> {
  const batch = await prisma.clipBatch.findFirst({
    where: {
      canvasId,
      note: { not: null },
      ...(options.userId ? { userId: options.userId } : {}),
    },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      note: true,
      source: true,
      createdAt: true,
      items: { select: { itemId: true }, orderBy: { position: "asc" } },
    },
  });
  if (!batch?.note) return null;
  return {
    batchId: batch.id,
    note: batch.note,
    source: batch.source,
    createdAt: batch.createdAt,
    itemIds: batch.items.map((item) => item.itemId),
  };
}
