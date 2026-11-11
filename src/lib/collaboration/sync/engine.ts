/**
 * IMP-042 — the sync server's document engine.
 *
 * Every loaded canvas has two Y.Docs holding the same accepted state: the live
 * Hocuspocus document clients sync with, and a private replica used to try
 * updates before anyone sees them. A client update is applied to the replica,
 * validated item by item, appended to `CanvasDocumentUpdate` and projected onto
 * `CanvasItem` rows in one transaction, and only then applied to the live
 * document — before Hocuspocus acknowledges it. An acknowledged edit is
 * therefore always durable, and a restart loses nothing a client was told was
 * saved. A refused update leaves the live document untouched and the replica
 * is rebuilt from it.
 *
 * Row changes made elsewhere (HTTP routes, agents, version restore) reach the
 * document through their committed canvas events: `catchUp` re-reads the rows
 * behind new events and writes the difference into both documents, persisting
 * that update with the advanced event cursor.
 *
 * All work on one canvas is serialized by a per-canvas lock, including load,
 * compaction and unload.
 *
 * IMP-043 — several sync servers may share one database. The update log is the
 * order of record: every write (a client update, a row reconciliation, a
 * compaction) runs in a transaction holding the canvas row lock and first
 * applies whatever other replicas stored since this one last looked
 * (`updateCursor`), so each replica writes on top of the latest stored
 * document and a row change is reconciled into the log exactly once. Other
 * replicas learn of new updates through `onCommitted` (published over Redis by
 * the server) and, as a fallback, the server's reconcile interval.
 *
 * @module lib/collaboration/sync/engine
 */

import * as Y from "yjs";
import type { PrismaClient } from "@/generated/prisma/client";
import { lockCanvasForMutation } from "@/lib/canvas/mutation-lock";
import { invalidateCanvasCache } from "@/lib/cache/canvas-cache";
import {
  applyItemState,
  createCanvasYDoc,
  documentItems,
} from "./document-items";
import { projectDocumentChanges } from "./projection";
import type { Prisma } from "@/generated/prisma/client";
import {
  appendCanvasDocumentUpdate,
  compactCanvasDocument,
  loadCanvasDocument,
  readDocumentChangesSince,
  reconcileDocumentFromEvents,
  type ReconcileResult,
} from "./store";
import {
  InvalidDocumentUpdateError,
  collectTouchedItems,
  validateTouchedItems,
} from "./validation";

/** Transaction origin for changes the server derives from rows. */
export const SERVER_ORIGIN = { source: "local" as const, skipStoreHooks: true };

/** Persisting failed for a reason other than the update itself. */
export class DocumentUnavailableError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "DocumentUnavailableError";
  }
}

export interface EngineLogger {
  info(object: object, message: string): void;
  warn(object: object, message: string): void;
  error(object: object, message: string): void;
}

export interface CanvasSyncEngineOptions {
  prisma: PrismaClient;
  logger: EngineLogger;
  /** Fold appended updates into the compacted state after this many. */
  compactAfterUpdates?: number;
  /** Largest single update accepted, in bytes. */
  maxUpdateBytes?: number;
  /** Called after this engine stored an update other replicas should pull. */
  onCommitted?: (canvasId: string) => void;
}

interface CanvasDocumentState {
  canvasId: string;
  replica: Y.Doc;
  live: Y.Doc | null;
  eventSequence: bigint;
  /** Highest stored update id applied to both documents. */
  updateCursor: bigint;
  pendingUpdates: number;
}

const WRITE_TRANSACTION = { maxWait: 5_000, timeout: 30_000 };

class KeyedLock {
  private readonly tails = new Map<string, Promise<void>>();

  run<T>(key: string, task: () => Promise<T>): Promise<T> {
    const previous = this.tails.get(key) ?? Promise.resolve();
    const result = previous.then(task);
    const tail = result.then(
      () => undefined,
      () => undefined,
    );
    this.tails.set(key, tail);
    void tail.then(() => {
      if (this.tails.get(key) === tail) this.tails.delete(key);
    });
    return result;
  }

  async drain(): Promise<void> {
    while (this.tails.size > 0) await Promise.all(this.tails.values());
  }
}

/** Apply `update` to `doc` and report what the resulting transaction did. */
function applyAndCapture(
  doc: Y.Doc,
  apply: () => void,
): { update: Uint8Array | null; transaction: Y.Transaction | null } {
  const updates: Uint8Array[] = [];
  let transaction: Y.Transaction | null = null;
  const onUpdate = (update: Uint8Array) => updates.push(update);
  const onTransaction = (tr: Y.Transaction) => {
    transaction = tr;
  };
  doc.on("update", onUpdate);
  doc.on("afterTransaction", onTransaction);
  try {
    apply();
  } finally {
    doc.off("update", onUpdate);
    doc.off("afterTransaction", onTransaction);
  }
  const update =
    updates.length === 0
      ? null
      : updates.length === 1
        ? updates[0]
        : Y.mergeUpdates(updates);
  return { update, transaction };
}

function hasPendingStructs(doc: Y.Doc): boolean {
  return doc.store.pendingStructs !== null || doc.store.pendingDs !== null;
}

function cloneDocument(source: Y.Doc): Y.Doc {
  const copy = createCanvasYDoc();
  Y.applyUpdate(copy, Y.encodeStateAsUpdate(source));
  return copy;
}

export class CanvasSyncEngine {
  private readonly states = new Map<string, CanvasDocumentState>();
  private readonly locks = new KeyedLock();
  private readonly prisma: PrismaClient;
  private readonly logger: EngineLogger;
  private readonly compactAfterUpdates: number;
  private readonly onCommitted: (canvasId: string) => void;
  readonly maxUpdateBytes: number;

  constructor(options: CanvasSyncEngineOptions) {
    this.prisma = options.prisma;
    this.logger = options.logger;
    this.compactAfterUpdates = options.compactAfterUpdates ?? 200;
    this.maxUpdateBytes = options.maxUpdateBytes ?? 4 * 1024 * 1024;
    this.onCommitted = options.onCommitted ?? (() => undefined);
  }

  /** Canvas ids with a loaded document. */
  loadedCanvasIds(): string[] {
    return Array.from(this.states.keys());
  }

  eventSequence(canvasId: string): bigint | null {
    return this.states.get(canvasId)?.eventSequence ?? null;
  }

  updateCursor(canvasId: string): bigint | null {
    return this.states.get(canvasId)?.updateCursor ?? null;
  }

  /**
   * Load (and lazily migrate) a canvas document, reconcile row changes made
   * since it was last open, and return its state for Hocuspocus.
   */
  load(canvasId: string): Promise<Uint8Array> {
    return this.locks.run(canvasId, async () => {
      const persisted = await loadCanvasDocument(this.prisma, canvasId);
      const state: CanvasDocumentState = {
        canvasId,
        replica: persisted.doc,
        live: null,
        eventSequence: persisted.eventSequence,
        updateCursor: persisted.updateCursor,
        pendingUpdates: persisted.pendingUpdates,
      };
      await this.reconcileLocked(state);
      this.states.set(canvasId, state);
      return Y.encodeStateAsUpdate(state.replica);
    });
  }

  /** Link the live Hocuspocus document once it holds the loaded state. */
  attach(canvasId: string, live: Y.Doc): void {
    const state = this.states.get(canvasId);
    if (!state) return;
    documentItems(live);
    state.live = live;
  }

  /**
   * Forget an unloaded document, compacting it first when worthwhile. A state
   * whose live document is still open belongs to a newer load and is kept.
   */
  unload(canvasId: string): Promise<void> {
    return this.locks.run(canvasId, async () => {
      const state = this.states.get(canvasId);
      if (!state || (state.live && !state.live.isDestroyed)) return;
      this.states.delete(canvasId);
      if (state.pendingUpdates > 0) await this.compactLocked(state);
      state.replica.destroy();
    });
  }

  /**
   * Validate, persist and apply one client update. Resolves only after the
   * update is durable and in the live document; rejects with
   * `InvalidDocumentUpdateError` for an update that must be discarded, or
   * `DocumentUnavailableError` when it could not be stored right now.
   */
  applyClientUpdate(input: {
    canvasId: string;
    actorId: string;
    update: Uint8Array;
    origin: unknown;
  }): Promise<void> {
    const { canvasId, actorId, update, origin } = input;
    return this.locks.run(canvasId, async () => {
      const state = this.states.get(canvasId);
      if (!state?.live)
        throw new DocumentUnavailableError("Canvas document is not loaded");
      if (update.byteLength > this.maxUpdateBytes)
        throw new InvalidDocumentUpdateError("The update is too large.");
      const live = state.live;

      let stored: {
        update: Uint8Array;
        removal: Uint8Array | null;
        id: bigint;
        changed: boolean;
      } | null = null;
      try {
        await this.prisma.$transaction(async (tx) => {
          await lockCanvasForMutation(tx, canvasId);
          // Write on top of what other replicas stored (IMP-043).
          await this.pullLocked(state, tx);
          const accepted = this.tryUpdate(state, live, update, origin);
          if (!accepted) return;
          const id = await appendCanvasDocumentUpdate(tx, {
            canvasId,
            update: accepted.update,
            actorId,
          });
          const projected = await projectDocumentChanges(tx, {
            canvasId,
            actorId,
            changes: accepted.changes,
          });
          let removal: Uint8Array | null = null;
          let cursor = id;
          if (projected.skippedForeignIds.length > 0) {
            // Items moved to another canvas leave this document (TASK-147).
            removal = this.removeItems(
              state.replica,
              projected.skippedForeignIds,
            );
            if (removal) {
              cursor = await appendCanvasDocumentUpdate(tx, {
                canvasId,
                update: removal,
                actorId: null,
              });
            }
            this.logger.info(
              { canvasId, itemIds: projected.skippedForeignIds },
              "Dropped document changes to items owned by another canvas",
            );
          }
          stored = {
            update: accepted.update,
            removal,
            id: cursor,
            changed: accepted.changes.length > 0,
          };
        }, WRITE_TRANSACTION);
      } catch (error) {
        this.rebuildReplica(state);
        if (error instanceof InvalidDocumentUpdateError) throw error;
        throw new DocumentUnavailableError("Could not store the update", {
          cause: error,
        });
      }
      if (!stored) return;
      const { update: accepted, removal, id, changed } = stored;

      Y.applyUpdate(live, accepted, origin);
      // Sent to every client, the sender included.
      if (removal) Y.applyUpdate(live, removal, SERVER_ORIGIN);
      state.updateCursor = id;
      state.pendingUpdates += 1;
      this.onCommitted(canvasId);
      if (changed) void invalidateCanvasCache(canvasId);
      if (state.pendingUpdates >= this.compactAfterUpdates)
        await this.compactLocked(state);
    });
  }

  /** Pull committed row changes into a loaded document. */
  catchUp(canvasId: string): Promise<void> {
    return this.locks.run(canvasId, async () => {
      const state = this.states.get(canvasId);
      if (!state?.live) return;
      await this.reconcileLocked(state);
    });
  }

  /**
   * Apply updates other sync replicas stored for a loaded document (IMP-043).
   * Reads one consistent snapshot; takes no canvas lock.
   */
  pull(canvasId: string): Promise<void> {
    return this.locks.run(canvasId, async () => {
      const state = this.states.get(canvasId);
      if (!state?.live) return;
      try {
        await this.prisma.$transaction((tx) => this.pullLocked(state, tx), {
          isolationLevel: "RepeatableRead",
        });
      } catch (error) {
        this.rebuildReplica(state);
        throw error;
      }
    });
  }

  /** Wait for every queued document operation, e.g. during shutdown. */
  async drain(): Promise<void> {
    await this.locks.drain();
  }

  /**
   * Apply `update` to the replica and validate it against the live document.
   * Returns null for an update that changes nothing.
   */
  private tryUpdate(
    state: CanvasDocumentState,
    live: Y.Doc,
    update: Uint8Array,
    origin: unknown,
  ): {
    update: Uint8Array;
    changes: ReturnType<typeof validateTouchedItems>;
  } | null {
    let applied: ReturnType<typeof applyAndCapture>;
    try {
      applied = applyAndCapture(state.replica, () =>
        Y.applyUpdate(state.replica, update, origin),
      );
    } catch (error) {
      throw new InvalidDocumentUpdateError(
        error instanceof Error ? error.message : "Malformed update.",
      );
    }
    if (hasPendingStructs(state.replica)) {
      // The update depends on changes this server never accepted.
      throw new InvalidDocumentUpdateError(
        "The update depends on unknown changes.",
      );
    }
    if (!applied.update || !applied.transaction) return null;
    const touched = collectTouchedItems(
      applied.transaction,
      documentItems(state.replica),
    );
    const changes = validateTouchedItems(
      touched,
      documentItems(live),
      documentItems(state.replica),
    );
    return { update: applied.update, changes };
  }

  /** Remove `ids` from `doc`; returns the update, or null if none changed. */
  private removeItems(doc: Y.Doc, ids: string[]): Uint8Array | null {
    return applyAndCapture(doc, () =>
      doc.transact(() => {
        const items = documentItems(doc);
        for (const id of ids) applyItemState(items, id, null);
      }, SERVER_ORIGIN),
    ).update;
  }

  /**
   * Apply every update stored after `updateCursor` to both documents. Call
   * inside a transaction that either holds the canvas row lock or reads one
   * snapshot.
   */
  private async pullLocked(
    state: CanvasDocumentState,
    tx: Prisma.TransactionClient,
  ): Promise<void> {
    const changes = await readDocumentChangesSince(
      tx,
      state.canvasId,
      state.updateCursor,
    );
    if (!changes)
      throw new DocumentUnavailableError("Canvas document no longer exists");
    const updates = changes.state
      ? [changes.state, ...changes.updates]
      : changes.updates;
    if (updates.length > 0) {
      const merged =
        updates.length === 1 ? updates[0] : Y.mergeUpdates(updates);
      Y.applyUpdate(state.replica, merged, SERVER_ORIGIN);
      if (state.live && !state.live.isDestroyed)
        Y.applyUpdate(state.live, merged, SERVER_ORIGIN);
      state.pendingUpdates = changes.state
        ? changes.updates.length
        : state.pendingUpdates + changes.updates.length;
    }
    state.updateCursor = changes.cursor;
    if (changes.eventSequence > state.eventSequence)
      state.eventSequence = changes.eventSequence;
  }

  private async reconcileLocked(state: CanvasDocumentState): Promise<void> {
    const { canvasId } = state;
    let stored: { update: Uint8Array | null; id: bigint | null } | null = null;
    let reconciled: ReconcileResult | null = null;
    try {
      await this.prisma.$transaction(async (tx) => {
        await lockCanvasForMutation(tx, canvasId);
        // Another replica may already have reconciled these events.
        await this.pullLocked(state, tx);
        const updates: Uint8Array[] = [];
        const onUpdate = (update: Uint8Array) => updates.push(update);
        state.replica.on("update", onUpdate);
        try {
          reconciled = await reconcileDocumentFromEvents(tx, {
            canvasId,
            doc: state.replica,
            afterSequence: state.eventSequence,
            origin: SERVER_ORIGIN,
          });
        } finally {
          state.replica.off("update", onUpdate);
        }
        if (reconciled.events === 0) return;
        const update = updates.length ? Y.mergeUpdates(updates) : null;
        const id = update
          ? await appendCanvasDocumentUpdate(tx, {
              canvasId,
              update,
              actorId: null,
            })
          : null;
        await tx.canvasDocument.update({
          where: { canvasId },
          data: { eventSequence: reconciled.eventSequence },
        });
        stored = { update, id };
      }, WRITE_TRANSACTION);
    } catch (error) {
      this.rebuildReplica(state);
      throw error;
    }
    const result = reconciled as ReconcileResult | null;
    if (!stored || !result) return;
    const { update, id } = stored;

    state.eventSequence = result.eventSequence;
    if (update && id !== null) {
      state.updateCursor = id;
      state.pendingUpdates += 1;
      if (state.live) Y.applyUpdate(state.live, update, SERVER_ORIGIN);
      this.onCommitted(canvasId);
    }
  }

  private async compactLocked(state: CanvasDocumentState): Promise<void> {
    try {
      await this.prisma.$transaction(async (tx) => {
        await lockCanvasForMutation(tx, state.canvasId);
        await this.pullLocked(state, tx);
        await compactCanvasDocument(
          tx,
          state.canvasId,
          state.replica,
          state.updateCursor,
        );
      }, WRITE_TRANSACTION);
      state.pendingUpdates = 0;
    } catch (error) {
      this.logger.error(
        { error, canvasId: state.canvasId },
        "Canvas document compaction failed",
      );
    }
  }

  /**
   * Reset the replica to the accepted state. Before the live document is
   * attached (during load) the replica is the only copy; a failure there
   * fails the load instead.
   */
  private rebuildReplica(state: CanvasDocumentState): void {
    if (!state.live || state.live.isDestroyed) {
      if (this.states.get(state.canvasId) === state)
        this.states.delete(state.canvasId);
      return;
    }
    state.replica.destroy();
    state.replica = cloneDocument(state.live);
  }
}
