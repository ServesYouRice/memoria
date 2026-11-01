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
 * compaction and unload. The engine assumes it is the only sync server for its
 * database (the launch topology runs one replica; see IMP-043).
 *
 * @module lib/collaboration/sync/engine
 */

import * as Y from "yjs";
import type { PrismaClient } from "@/generated/prisma/client";
import { lockCanvasForMutation } from "@/lib/canvas/mutation-lock";
import { invalidateCanvasCache } from "@/lib/cache/canvas-cache";
import { createCanvasYDoc, documentItems } from "./document-items";
import { projectDocumentChanges } from "./projection";
import {
  appendCanvasDocumentUpdate,
  compactCanvasDocument,
  loadCanvasDocument,
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
}

interface CanvasDocumentState {
  canvasId: string;
  replica: Y.Doc;
  live: Y.Doc | null;
  eventSequence: bigint;
  pendingUpdates: number;
}

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
  readonly maxUpdateBytes: number;

  constructor(options: CanvasSyncEngineOptions) {
    this.prisma = options.prisma;
    this.logger = options.logger;
    this.compactAfterUpdates = options.compactAfterUpdates ?? 200;
    this.maxUpdateBytes = options.maxUpdateBytes ?? 4 * 1024 * 1024;
  }

  /** Canvas ids with a loaded document. */
  loadedCanvasIds(): string[] {
    return Array.from(this.states.keys());
  }

  eventSequence(canvasId: string): bigint | null {
    return this.states.get(canvasId)?.eventSequence ?? null;
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
      if (state.pendingUpdates > 0) {
        await compactCanvasDocument(this.prisma, canvasId, state.replica).catch(
          (error) =>
            this.logger.error(
              { error, canvasId },
              "Canvas document compaction failed",
            ),
        );
      }
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
      let applied: ReturnType<typeof applyAndCapture>;
      try {
        applied = applyAndCapture(state.replica, () =>
          Y.applyUpdate(state.replica, update, origin),
        );
      } catch (error) {
        this.rebuildReplica(state);
        throw new InvalidDocumentUpdateError(
          error instanceof Error ? error.message : "Malformed update.",
        );
      }

      if (hasPendingStructs(state.replica)) {
        // The update depends on changes this server never accepted.
        this.rebuildReplica(state);
        throw new InvalidDocumentUpdateError(
          "The update depends on unknown changes.",
        );
      }
      if (!applied.update || !applied.transaction) return;

      let changes;
      try {
        const touched = collectTouchedItems(
          applied.transaction,
          documentItems(state.replica),
        );
        changes = validateTouchedItems(
          touched,
          documentItems(live),
          documentItems(state.replica),
        );
      } catch (error) {
        this.rebuildReplica(state);
        throw error;
      }

      try {
        await this.prisma.$transaction(
          async (tx) => {
            await lockCanvasForMutation(tx, canvasId);
            await appendCanvasDocumentUpdate(tx, {
              canvasId,
              update: applied.update as Uint8Array,
              actorId,
            });
            await projectDocumentChanges(tx, { canvasId, actorId, changes });
          },
          { maxWait: 5_000, timeout: 15_000 },
        );
      } catch (error) {
        this.rebuildReplica(state);
        if (error instanceof InvalidDocumentUpdateError) throw error;
        throw new DocumentUnavailableError("Could not store the update", {
          cause: error,
        });
      }

      Y.applyUpdate(live, applied.update, origin);
      state.pendingUpdates += 1;
      if (changes.length > 0) void invalidateCanvasCache(canvasId);
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

  /** Wait for every queued document operation, e.g. during shutdown. */
  async drain(): Promise<void> {
    await this.locks.drain();
  }

  private async reconcileLocked(state: CanvasDocumentState): Promise<void> {
    const { canvasId, replica } = state;
    const updates: Uint8Array[] = [];
    const onUpdate = (update: Uint8Array) => updates.push(update);
    let reconciled: ReconcileResult;
    replica.on("update", onUpdate);
    try {
      reconciled = await reconcileDocumentFromEvents(this.prisma, {
        canvasId,
        doc: replica,
        afterSequence: state.eventSequence,
        origin: SERVER_ORIGIN,
      });
    } catch (error) {
      this.rebuildReplica(state);
      throw error;
    } finally {
      replica.off("update", onUpdate);
    }
    if (reconciled.events === 0) return;

    const update = updates.length ? Y.mergeUpdates(updates) : null;
    try {
      await this.prisma.$transaction(async (tx) => {
        if (update)
          await appendCanvasDocumentUpdate(tx, {
            canvasId,
            update,
            actorId: null,
          });
        await tx.canvasDocument.update({
          where: { canvasId },
          data: { eventSequence: reconciled.eventSequence },
        });
      });
    } catch (error) {
      this.rebuildReplica(state);
      throw error;
    }

    state.eventSequence = reconciled.eventSequence;
    if (update) {
      state.pendingUpdates += 1;
      if (state.live) Y.applyUpdate(state.live, update, SERVER_ORIGIN);
    }
  }

  private async compactLocked(state: CanvasDocumentState): Promise<void> {
    try {
      await compactCanvasDocument(this.prisma, state.canvasId, state.replica);
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
    if (!state.live) {
      this.states.delete(state.canvasId);
      return;
    }
    state.replica.destroy();
    state.replica = cloneDocument(state.live);
  }
}
