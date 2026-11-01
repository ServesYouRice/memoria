/**
 * IMP-042 — PostgreSQL persistence for collaborative canvas documents.
 *
 * `CanvasDocument.state` is the compacted Yjs state; `CanvasDocumentUpdate`
 * rows are the updates accepted since. A document is current when every update
 * row has been applied on top of the state. Canvases that predate IMP-042
 * migrate lazily: the first load builds the document from the live
 * `CanvasItem` rows under the canvas lock, so no committed write can slip
 * between the rows read and the event cursor stored with them.
 *
 * Only the sync server writes these tables; reconciliation helpers are shared
 * with the version route so snapshots see what the sync server will converge to.
 *
 * @module lib/collaboration/sync/store
 */

import * as Y from "yjs";
import type { Prisma, PrismaClient } from "@/generated/prisma/client";
import type { ItemType } from "@/types/canvas";
import { lockCanvasForMutation } from "@/lib/canvas/mutation-lock";
import {
  type CanvasItemState,
  applyItemState,
  createDocumentFromRows,
  createCanvasYDoc,
  documentItems,
  replaceAllItemStates,
} from "./document-items";

type Store = PrismaClient | Prisma.TransactionClient;

export const ITEM_STATE_SELECT = {
  id: true,
  type: true,
  positionX: true,
  positionY: true,
  width: true,
  height: true,
  zIndex: true,
  tags: true,
  content: true,
} as const;

type ItemStateRow = Prisma.CanvasItemGetPayload<{
  select: typeof ITEM_STATE_SELECT;
}>;

export function rowToItemState(row: ItemStateRow): CanvasItemState {
  return { ...row, type: row.type as unknown as ItemType };
}

/** Copy into a standalone buffer: Prisma's Bytes type wants a plain ArrayBuffer. */
export function toBytes(update: Uint8Array): Uint8Array<ArrayBuffer> {
  return new Uint8Array(update);
}

export class CanvasNotFoundError extends Error {
  constructor(canvasId: string) {
    super(`Canvas ${canvasId} does not exist`);
    this.name = "CanvasNotFoundError";
  }
}

export interface PersistedCanvasDocument {
  doc: Y.Doc;
  /** Highest `CanvasEvent.sequence` already reconciled into the document. */
  eventSequence: bigint;
  /** Update rows not yet folded into the compacted state. */
  pendingUpdates: number;
}

async function migrateCanvasDocument(
  prisma: PrismaClient,
  canvasId: string,
): Promise<void> {
  await prisma.$transaction(
    async (tx) => {
      await lockCanvasForMutation(tx, canvasId);
      const [canvas, existing] = await Promise.all([
        tx.canvas.findUnique({ where: { id: canvasId }, select: { id: true } }),
        tx.canvasDocument.findUnique({
          where: { canvasId },
          select: { canvasId: true },
        }),
      ]);
      if (!canvas) throw new CanvasNotFoundError(canvasId);
      if (existing) return;
      const [rows, lastEvent] = await Promise.all([
        tx.canvasItem.findMany({
          where: { canvasId, deletedAt: null },
          select: ITEM_STATE_SELECT,
          orderBy: { id: "asc" },
        }),
        tx.canvasEvent.findFirst({
          where: { canvasId },
          orderBy: { sequence: "desc" },
          select: { sequence: true },
        }),
      ]);
      const doc = createDocumentFromRows(rows.map(rowToItemState));
      await tx.canvasDocument.create({
        data: {
          canvasId,
          state: toBytes(Y.encodeStateAsUpdate(doc)),
          eventSequence: lastEvent?.sequence ?? BigInt(0),
        },
      });
      doc.destroy();
    },
    { maxWait: 5_000, timeout: 30_000 },
  );
}

/**
 * Read the persisted document (state plus every appended update). Returns
 * null when the canvas has no document yet.
 */
export async function readPersistedCanvasDocument(
  store: Store,
  canvasId: string,
): Promise<PersistedCanvasDocument | null> {
  const record = await store.canvasDocument.findUnique({
    where: { canvasId },
    select: { state: true, compactedThrough: true, eventSequence: true },
  });
  if (!record) return null;
  const updates = await store.canvasDocumentUpdate.findMany({
    where: { canvasId, id: { gt: record.compactedThrough } },
    orderBy: { id: "asc" },
    select: { update: true },
  });
  const doc = createCanvasYDoc();
  Y.applyUpdate(doc, record.state);
  for (const { update } of updates) Y.applyUpdate(doc, update);
  return {
    doc,
    eventSequence: record.eventSequence,
    pendingUpdates: updates.length,
  };
}

/** Load a canvas's document, migrating it from its rows on first use. */
export async function loadCanvasDocument(
  prisma: PrismaClient,
  canvasId: string,
): Promise<PersistedCanvasDocument> {
  const persisted = await readPersistedCanvasDocument(prisma, canvasId);
  if (persisted) return persisted;
  await migrateCanvasDocument(prisma, canvasId);
  const migrated = await readPersistedCanvasDocument(prisma, canvasId);
  if (!migrated) throw new CanvasNotFoundError(canvasId);
  return migrated;
}

export async function appendCanvasDocumentUpdate(
  tx: Prisma.TransactionClient,
  input: { canvasId: string; update: Uint8Array; actorId: string | null },
): Promise<void> {
  await tx.canvasDocumentUpdate.create({
    data: {
      canvasId: input.canvasId,
      update: toBytes(input.update),
      actorId: input.actorId,
    },
    select: { id: true },
  });
}

/**
 * Fold the appended updates into the compacted state. `doc` must hold exactly
 * the persisted document, which the sync server guarantees by compacting under
 * the document's lock.
 */
export async function compactCanvasDocument(
  prisma: PrismaClient,
  canvasId: string,
  doc: Y.Doc,
): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const last = await tx.canvasDocumentUpdate.findFirst({
      where: { canvasId },
      orderBy: { id: "desc" },
      select: { id: true },
    });
    if (!last) return;
    await tx.canvasDocument.update({
      where: { canvasId },
      data: {
        state: toBytes(Y.encodeStateAsUpdate(doc)),
        compactedThrough: last.id,
      },
    });
    await tx.canvasDocumentUpdate.deleteMany({
      where: { canvasId, id: { lte: last.id } },
    });
  });
}

export interface ReconcileResult {
  /** Highest event sequence the document now reflects. */
  eventSequence: bigint;
  /** Number of events read. */
  events: number;
}

const RECONCILE_BATCH = 500;

/**
 * Bring `doc` in line with the committed `CanvasItem` rows behind every
 * canvas event after `afterSequence` (HTTP, agent and restore writes). Rows
 * are read as they are now, so replaying an event is harmless. The caller
 * persists whatever update this produces together with the new sequence.
 */
export async function reconcileDocumentFromEvents(
  store: Store,
  input: {
    canvasId: string;
    doc: Y.Doc;
    afterSequence: bigint;
    origin: unknown;
  },
): Promise<ReconcileResult> {
  const { canvasId, doc, origin } = input;
  let eventSequence = input.afterSequence;
  let total = 0;

  for (;;) {
    const events = await store.canvasEvent.findMany({
      where: { canvasId, sequence: { gt: eventSequence } },
      orderBy: { sequence: "asc" },
      take: RECONCILE_BATCH,
      select: { sequence: true, entityId: true, operation: true },
    });
    if (events.length === 0) break;
    total += events.length;
    eventSequence = events[events.length - 1].sequence;

    if (events.some((event) => event.operation === "restored")) {
      const rows = await store.canvasItem.findMany({
        where: { canvasId, deletedAt: null },
        select: ITEM_STATE_SELECT,
        orderBy: { id: "asc" },
      });
      doc.transact(
        () => replaceAllItemStates(doc, rows.map(rowToItemState)),
        origin,
      );
    } else {
      const ids = Array.from(new Set(events.map((event) => event.entityId)));
      const rows = await store.canvasItem.findMany({
        where: { canvasId, id: { in: ids }, deletedAt: null },
        select: ITEM_STATE_SELECT,
      });
      const live = new Map(rows.map((row) => [row.id, row] as const));
      const items = documentItems(doc);
      doc.transact(() => {
        for (const id of ids) {
          const row = live.get(id);
          applyItemState(items, id, row ? rowToItemState(row) : null);
        }
      }, origin);
    }
    if (events.length < RECONCILE_BATCH) break;
  }

  return { eventSequence, events: total };
}

/**
 * The canvas document as it stands now: the persisted state brought up to
 * date with row writes the sync server has not reconciled yet (for example
 * while nobody has the canvas open), or a document built from the rows when
 * the canvas was never opened collaboratively. Read-only; call inside a
 * transaction that holds the canvas mutation lock so no update lands midway.
 */
export async function readCurrentCanvasDocument(
  tx: Prisma.TransactionClient,
  canvasId: string,
): Promise<Y.Doc> {
  const persisted = await readPersistedCanvasDocument(tx, canvasId);
  if (!persisted) {
    const rows = await tx.canvasItem.findMany({
      where: { canvasId, deletedAt: null },
      select: ITEM_STATE_SELECT,
      orderBy: { id: "asc" },
    });
    return createDocumentFromRows(rows.map(rowToItemState));
  }
  await reconcileDocumentFromEvents(tx, {
    canvasId,
    doc: persisted.doc,
    afterSequence: persisted.eventSequence,
    origin: null,
  });
  return persisted.doc;
}
