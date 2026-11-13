/**
 * Clip batches: many links saved to the Inbox in one request.
 *
 * Used by the browser extension's "save all tabs" (IMP-061) and the phone
 * share target (IMP-062). A batch is all-or-nothing: the items, their
 * committed events and the batch record are written in one transaction, and a
 * retry with the same idempotency key returns the first result instead of
 * creating the links again. The optional sorting note is kept on the batch for
 * the Inbox sorter (IMP-063). Links already in the user's boards are reported
 * as `duplicates` (IMP-065), and left out when the batch asks to skip them.
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
import { MAX_BOOKMARK_TITLE_LENGTH } from "@/lib/constants";
import { parseCanvasItemContent } from "@/lib/validation/canvas-item";
import { enqueueLinkEnrichment } from "@/lib/services/link-enrichment";
import {
  existingFor,
  existingLinkPath,
  findExistingLinks,
  normalizeLinkUrl,
  type ExistingLink,
} from "@/lib/services/duplicates";
import {
  clipBatchSchema,
  type ClipBatchInput,
} from "@/lib/validation/extension";

export { ClipBatchSource };

const LINK_SIZE = { width: 360, height: 120 };

export interface ClipBatchDuplicate {
  /** Position of the link in the request. */
  index: number;
  url: string;
  /** The item this batch saved for the link; null when it was skipped. */
  savedItemId: string | null;
  /** Copies already in the user's boards, oldest first. */
  existing: ExistingLink[];
}

export interface ClipBatchResult {
  batchId: string;
  canvasId: string;
  /**
   * Created item ids, in the order the links were sent. With
   * `skipDuplicates`, links that were already saved have no entry here.
   */
  itemIds: string[];
  /** True when this call replayed an earlier batch with the same key. */
  replayed: boolean;
  /** Links already in the user's boards (IMP-065). */
  duplicates: ClipBatchDuplicate[];
}

/**
 * The saved bookmark's title: the sent title, or the URL cut to the bookmark
 * title limit, since a URL may be longer than a title can be.
 */
function bookmarkTitle(link: ClipBatchInput["links"][number]) {
  return (link.title?.trim() || link.url).slice(0, MAX_BOOKMARK_TITLE_LENGTH);
}

function hashBatch(input: ClipBatchInput) {
  return createHash("sha256")
    .update(
      JSON.stringify({
        links: input.links,
        note: input.note ?? null,
        // Only present when set, so earlier batches keep their hash.
        ...(input.skipDuplicates ? { skipDuplicates: true } : {}),
      }),
    )
    .digest("hex");
}

/**
 * With `skipDuplicates`, a link whose normalized URL already appeared earlier
 * in the batch is not saved again. Maps each such repeat's position to the
 * position of the copy this batch saved.
 */
function batchRepeats(
  links: ClipBatchInput["links"],
  savedByIndex: Map<number, string>,
): Map<number, number> {
  const firstSaved = new Map<string, number>();
  const repeats = new Map<number, number>();
  links.forEach((link, index) => {
    const key = normalizeLinkUrl(link.url);
    if (!key) return;
    if (savedByIndex.has(index)) {
      if (!firstSaved.has(key)) firstSaved.set(key, index);
      return;
    }
    const first = firstSaved.get(key);
    if (first !== undefined) repeats.set(index, first);
  });
  return repeats;
}

function describeDuplicates(
  links: ClipBatchInput["links"],
  found: Map<string, ExistingLink[]>,
  savedByIndex: Map<number, string>,
  inbox: { canvasId: string; skipDuplicates: boolean },
): ClipBatchDuplicate[] {
  const repeats = inbox.skipDuplicates
    ? batchRepeats(links, savedByIndex)
    : new Map<number, number>();
  return links.flatMap((link, index) => {
    const first = repeats.get(index);
    const existing: ExistingLink[] =
      first !== undefined
        ? [
            {
              itemId: savedByIndex.get(first)!,
              canvasId: inbox.canvasId,
              canvasName: INBOX_CANVAS_NAME,
              title: bookmarkTitle(links[first]!),
              url: links[first]!.url,
              path: existingLinkPath(inbox.canvasId, savedByIndex.get(first)!),
            },
          ]
        : existingFor(found, link.url);
    return existing.length > 0
      ? [
          {
            index,
            url: link.url,
            savedItemId: savedByIndex.get(index) ?? null,
            existing,
          },
        ]
      : [];
  });
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

export async function findOrCreateInbox(
  tx: Prisma.TransactionClient,
  userId: string,
) {
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
        items: {
          select: { itemId: true, position: true },
          orderBy: { position: "asc" },
        },
      },
    });
    if (previous) {
      if (previous.requestHash !== requestHash) {
        throw new ConflictError(
          "This idempotency key was already used for a different batch.",
        );
      }
      const itemIds = previous.items.map((item) => item.itemId);
      const found = await findExistingLinks(
        tx,
        userId,
        data.links.map((link) => link.url),
        { excludeItemIds: itemIds },
      );
      return {
        batchId: previous.id,
        canvasId: previous.canvasId,
        itemIds,
        replayed: true,
        duplicates: describeDuplicates(
          data.links,
          found,
          new Map(previous.items.map((item) => [item.position, item.itemId])),
          {
            canvasId: previous.canvasId,
            skipDuplicates: !!data.skipDuplicates,
          },
        ),
      };
    }

    const canvasId = await findOrCreateInbox(tx, userId);
    await lockCanvasForMutation(tx, canvasId);

    // Under the Inbox lock, so a concurrent batch's saved links are visible
    // and two batches cannot both save the same new link.
    const found = await findExistingLinks(
      tx,
      userId,
      data.links.map((link) => link.url),
    );
    // Original request positions of the links this batch saves. With
    // skipDuplicates, a link repeated within the batch is saved once.
    const seen = new Set<string>();
    const positions = data.links
      .map((link, index) => ({ link, index }))
      .filter(({ link }) => {
        if (!data.skipDuplicates) return true;
        if (existingFor(found, link.url).length > 0) return false;
        const key = normalizeLinkUrl(link.url);
        if (!key) return true;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
    await assertCanvasItemCapacity(tx, canvasId, positions.length);

    const occupied = await tx.canvasItem.findMany({
      where: { canvasId, deletedAt: null },
      select: { positionX: true, positionY: true, width: true, height: true },
    });
    const rows = positions.map(({ link }) => {
      const slot = findOpenSlot(occupied, LINK_SIZE);
      const rect = { positionX: slot.x, positionY: slot.y, ...LINK_SIZE };
      occupied.push(rect);
      const content = parseCanvasItemContent(ItemType.BOOKMARK, {
        url: link.url,
        title: bookmarkTitle(link),
      });
      return {
        canvasId,
        type: ItemType.BOOKMARK,
        ...rect,
        zIndex: 1,
        content: content as Prisma.InputJsonValue,
        normalizedUrl: normalizeLinkUrl(link.url),
        createdById: userId,
        updatedById: userId,
      };
    });

    // INSERT ... RETURNING gives rows back in input order.
    const items =
      rows.length > 0
        ? await tx.canvasItem.createManyAndReturn({
            data: rows,
            select: { id: true, version: true },
          })
        : [];
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
            data: items.map((item, created) => ({
              itemId: item.id,
              position: positions[created]!.index,
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
    // One background naming/tagging job per link (IMP-064).
    await enqueueLinkEnrichment(
      tx,
      userId,
      items.map((item, created) => {
        const link = positions[created]!.link;
        return { itemId: item.id, baseTitle: bookmarkTitle(link) };
      }),
    );

    return {
      batchId: batch.id,
      canvasId,
      itemIds: items.map((item) => item.id),
      replayed: false,
      duplicates: describeDuplicates(
        data.links,
        found,
        new Map(
          items.map((item, created) => [positions[created]!.index, item.id]),
        ),
        { canvasId, skipDuplicates: !!data.skipDuplicates },
      ),
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
