/**
 * IMP-042 — the browser side of a canvas document: one Hocuspocus provider
 * per open canvas, a cached view of its items for rendering, and local writes
 * validated with the same schemas the sync server applies.
 *
 * Writes land in the local document at once and reach the sync server in
 * batches; the server stores each batch before acknowledging it. When the
 * server refuses a change (`memoria:invalid-update`) the session discards its
 * document and loads the server's copy again; when access is refused or
 * revoked (`memoria:forbidden`) the session stops and the canvas falls back
 * to the HTTP API; when the server cannot store a change right now
 * (`memoria:unavailable`) the session reconnects and resends it; when the
 * role changes (`memoria:reauthenticate`) it reconnects to learn the new
 * scope, discarding unsaved changes if it may no longer edit.
 *
 * IMP-045 — with a device cache (`offline-store.ts`) the session also keeps
 * the document on this device: every update is appended to IndexedDB, and a
 * session that opens with a stored copy renders and edits it at once, even
 * without a network, using the scope the server last granted. Local edits
 * are counted until the server confirms storing them, so the count survives
 * a reload. On reconnect the normal sync handshake sends the server whatever
 * it lacks, through the same validation as any other update. Whenever the
 * session discards its document (a refused change, lost edit access) or
 * loses access, it clears the stored copy first, so a discarded change is
 * never restored or sent again.
 *
 * Framework-free; React binds it through `lib/hooks/use-canvas-document`.
 *
 * @module lib/collaboration/sync/client-session
 */

import * as Y from "yjs";
import * as syncProtocol from "y-protocols/sync";
import { HocuspocusProvider } from "@hocuspocus/provider";
import { ItemType } from "@/types/canvas";
import { isLaunchCapabilityEnabled } from "@/lib/product-surfaces";
import { LAUNCH_LIMITS } from "@/lib/policy/launch-limits";
import { normalizeNoteContent } from "@/lib/rich-text/note-format";
import {
  createCanvasItemSchema,
  parseCanvasItemContent,
  updateCanvasItemSchema,
} from "@/lib/validation/canvas-item";
import {
  type CanvasItemState,
  type ItemMap,
  applyItemState,
  createCanvasYDoc,
  documentItems,
  isNoteTextFragment,
  readItemState,
} from "./document-items";
import {
  COLLABORATION_SYNC_PATH,
  NOTE_TEXT_KEY,
  SYNC_CLOSE_REASONS,
  createCanvasItemId,
} from "./protocol";
import type {
  CanvasDocumentCache,
  CanvasDocumentCacheMeta,
} from "./offline-store";

export interface CanvasDocumentEntry {
  state: CanvasItemState;
  /**
   * When this client saw the item change after the first sync; null for
   * items as they were loaded. A new value means "render again".
   */
  changedAt: Date | null;
}

export interface CanvasDocumentSnapshot {
  /** Synced since the last reset: render from the document. */
  ready: boolean;
  /** The sync server accepts this session's changes (owner or editor). */
  writable: boolean;
  connected: boolean;
  /** Local changes the sync server has not acknowledged (stored) yet. */
  pendingChanges: number;
  /**
   * IMP-045 — local edits the sync server has not confirmed storing,
   * including edits kept on this device from an earlier visit.
   */
  unsavedChanges: number;
  /**
   * The document shows the copy kept on this device and has not synced with
   * the server since it opened.
   */
  restored: boolean;
  /** The canvas name kept with the device copy, for opening offline. */
  canvasName: string | null;
  /** This client changed the document since the last reset. */
  localChanges: boolean;
  /** Access was refused or revoked; the canvas uses the HTTP API instead. */
  forbidden: boolean;
  /** Increments when a refused change or lost access replaced the document. */
  generation: number;
  /** Increments when the server reports a change in access. */
  accessRevision: number;
  /**
   * The server closed the connection over a message too large to accept;
   * the session keeps its unsaved edits and retries with a growing delay.
   */
  sendBlocked?: boolean;
  items: ReadonlyMap<string, CanvasDocumentEntry>;
}

export interface CanvasDocumentSessionOptions {
  canvasId: string;
  /** WebSocket URL of the sync endpoint. */
  url: string;
  /** The server refused a local change; the document was reloaded. */
  onRejectedChange?: () => void;
  /** The canvas's public share token, when opened from its share link. */
  shareToken?: string;
  /** Delay before reconnecting after `memoria:unavailable`. */
  retryDelayMs?: number;
  /** Node test clients pass a cookie-carrying WebSocket implementation. */
  WebSocketPolyfill?: unknown;
  /** IMP-045 — this user's device copy of the canvas; none keeps no copy. */
  cache?: CanvasDocumentCache | null;
  /** Fold the device copy's appended updates into one after this many. */
  cacheCompactAfter?: number;
}

/** Item fields a document write may change. */
export interface CanvasDocumentItemChanges {
  positionX?: number;
  positionY?: number;
  width?: number;
  height?: number;
  zIndex?: number;
  tags?: string[];
  content?: unknown;
}

export interface CanvasDocumentItemInput {
  canvasId: string;
  type: ItemType;
  positionX: number;
  positionY: number;
  width: number;
  height: number;
  zIndex?: number;
  content: unknown;
  tags?: string[];
}

/** Marks this client's own writes in Yjs transactions. */
export const LOCAL_WRITE_ORIGIN = Symbol("memoria:local-write");
/** Marks the device copy being loaded into a fresh document. */
const CACHE_ORIGIN = Symbol("memoria:device-copy");

const updateFieldsSchema = updateCanvasItemSchema.omit({ version: true });

/** WebSocket close code for a message over the receiver's size limit. */
const MESSAGE_TOO_BIG_CLOSE_CODE = 1009;
const MAX_RETRY_DELAY_MS = 30_000;
/** Hocuspocus message type of Yjs sync messages, and the update subtype. */
const SYNC_MESSAGE_TYPE = 0;

/** The provider's offline send queue, which its types keep private. */
interface QueuedSocket {
  messageQueue?: unknown[];
}

/**
 * Remove this document's Yjs updates from the provider's offline queue and
 * its batch. The handshake's sync step 2 carries every change they hold.
 */
function dropQueuedDocumentUpdates(provider: HocuspocusProvider): void {
  const socket = provider.configuration.websocketProvider as unknown as
    QueuedSocket | undefined;
  const queue = socket?.messageQueue;
  if (Array.isArray(queue)) {
    socket!.messageQueue = queue.filter(
      (message) =>
        !(
          message instanceof Uint8Array &&
          isDocumentUpdate(message, provider.effectiveName)
        ),
    );
  }
  const batch = provider as unknown as { pendingUpdates?: unknown[] };
  if (Array.isArray(batch.pendingUpdates)) batch.pendingUpdates = [];
}

function isDocumentUpdate(message: Uint8Array, documentName: string): boolean {
  // Header: varString document name, varUint message type, varUint subtype.
  let offset = 0;
  const readVarUint = (): number => {
    let value = 0;
    for (let shift = 0; shift < 35; shift += 7) {
      if (offset >= message.length) throw new RangeError("short message");
      const byte = message[offset++];
      value += (byte & 0x7f) * 2 ** shift;
      if (byte < 0x80) return value;
    }
    throw new RangeError("varint too long");
  };
  try {
    const nameLength = readVarUint();
    if (offset + nameLength > message.length) return false;
    const name = new TextDecoder().decode(
      message.subarray(offset, offset + nameLength),
    );
    offset += nameLength;
    return (
      name === documentName &&
      readVarUint() === SYNC_MESSAGE_TYPE &&
      readVarUint() === syncProtocol.messageYjsUpdate
    );
  } catch {
    return false;
  }
}

export function collaborationSyncUrl(location: {
  protocol: string;
  host: string;
}): string {
  const protocol = location.protocol === "https:" ? "wss:" : "ws:";
  return `${protocol}//${location.host}${COLLABORATION_SYNC_PATH}`;
}

/** Normalize item content exactly as the HTTP API would store it. */
function normalizeContent(type: ItemType, content: unknown): unknown {
  if (type === ItemType.NOTE) return normalizeNoteContent(content);
  return parseCanvasItemContent(type, content);
}

export class CanvasDocumentSession {
  readonly canvasId: string;
  private readonly options: CanvasDocumentSessionOptions;
  private doc!: Y.Doc;
  private items!: Y.Map<ItemMap>;
  private provider: HocuspocusProvider | null = null;
  private snapshot: CanvasDocumentSnapshot = {
    ready: false,
    writable: false,
    connected: false,
    pendingChanges: 0,
    unsavedChanges: 0,
    restored: false,
    canvasName: null,
    localChanges: false,
    forbidden: false,
    generation: 0,
    accessRevision: 0,
    items: new Map(),
  };
  private readonly listeners = new Set<() => void>();
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  /** Consecutive retries since the last sync, for the backoff. */
  private retryAttempts = 0;
  private destroyed = false;
  private readonly cache: CanvasDocumentCache | null;
  /** Writes to the device copy stopped (one failed, or access was lost). */
  private cacheStopped = false;
  private updatesSinceCompaction = 0;
  private cacheWrites: Promise<unknown> = Promise.resolve();
  /** connect() ran while the browser was offline; the online event connects. */
  private waitingForNetwork = false;

  constructor(options: CanvasDocumentSessionOptions) {
    this.options = options;
    this.canvasId = options.canvasId;
    this.cache = options.cache ?? null;
    this.attachDocument();
    if (this.cache) void this.restore(this.cache);
    else this.connect();
    if (typeof window !== "undefined") {
      window.addEventListener("online", this.onOnline);
      window.addEventListener("offline", this.onOffline);
    }
  }

  getSnapshot = (): CanvasDocumentSnapshot => this.snapshot;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  /** Writes go through the document rather than the HTTP API. */
  get acceptsWrites(): boolean {
    return (
      !this.destroyed &&
      this.snapshot.ready &&
      this.snapshot.writable &&
      !this.snapshot.forbidden
    );
  }

  /** Settles once every device-copy write issued so far has finished. */
  whenCached(): Promise<void> {
    return this.cacheWrites.then(() => undefined);
  }

  /** Keep the canvas name with the device copy, for opening offline. */
  rememberCanvasName(name: string): void {
    if (this.destroyed || !name || this.snapshot.canvasName === name) return;
    this.update({ canvasName: name });
    if (this.snapshot.ready)
      this.writeCache((cache) => cache.saveMeta(this.cacheMeta()));
  }

  hasItem(itemId: string): boolean {
    return this.items.has(itemId);
  }

  /** The shared rich text of a note, for the collaborative editor. */
  noteFragment(itemId: string): Y.XmlFragment | null {
    const map = this.items.get(itemId);
    const fragment = map?.get(NOTE_TEXT_KEY);
    return isNoteTextFragment(fragment) ? fragment : null;
  }

  createItem(input: CanvasDocumentItemInput): CanvasItemState {
    this.assertWritable();
    const parsed = createCanvasItemSchema.parse(input);
    if (parsed.canvasId !== this.canvasId)
      throw new Error("The item belongs to another canvas.");
    if (parsed.type === ItemType.POLL && !isLaunchCapabilityEnabled("polls"))
      throw new Error(
        "Polls are disabled until voting is server-authoritative.",
      );
    if (this.items.size >= LAUNCH_LIMITS.itemsPerCanvas)
      throw new Error("This canvas has reached its item limit.");
    const state: CanvasItemState = {
      id: createCanvasItemId(),
      type: parsed.type,
      positionX: parsed.positionX,
      positionY: parsed.positionY,
      width: parsed.width,
      height: parsed.height,
      zIndex: parsed.zIndex,
      tags: parsed.tags,
      content: normalizeContent(parsed.type, parsed.content),
    };
    this.doc.transact(
      () => applyItemState(this.items, state.id, state),
      LOCAL_WRITE_ORIGIN,
    );
    return state;
  }

  updateItem(
    itemId: string,
    changes: CanvasDocumentItemChanges,
  ): CanvasItemState {
    const [state] = this.updateItems([{ itemId, changes }]);
    return state;
  }

  /** Apply several item updates as one change (one stored update). */
  updateItems(
    updates: Array<{ itemId: string; changes: CanvasDocumentItemChanges }>,
  ): CanvasItemState[] {
    this.assertWritable();
    const next = updates.map(({ itemId, changes }) => {
      const current = readItemState(itemId, this.items.get(itemId));
      if (!current) throw new Error("This item no longer exists.");
      const { content, ...fields } = updateFieldsSchema.parse(changes);
      const defined = Object.fromEntries(
        Object.entries(fields).filter(([, value]) => value !== undefined),
      ) as Partial<CanvasItemState>;
      return {
        ...current,
        ...defined,
        ...(content !== undefined
          ? { content: normalizeContent(current.type, content) }
          : {}),
      };
    });
    this.doc.transact(() => {
      for (const state of next) applyItemState(this.items, state.id, state);
    }, LOCAL_WRITE_ORIGIN);
    return next;
  }

  deleteItem(itemId: string): void {
    this.assertWritable();
    if (!this.items.has(itemId)) return;
    this.doc.transact(() => this.items.delete(itemId), LOCAL_WRITE_ORIGIN);
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    if (typeof window !== "undefined") {
      window.removeEventListener("online", this.onOnline);
      window.removeEventListener("offline", this.onOffline);
    }
    this.clearRetry();
    this.disconnect();
    this.detachDocument();
    this.listeners.clear();
  }

  /**
   * IMP-045: when the browser loses its network, stop at once rather than
   * wait for the socket to time out, so the board shows edits as kept on
   * this device; reconnect as soon as the network is back (the provider
   * would otherwise back off for up to 30 seconds between attempts).
   */
  private onOffline = () => {
    const provider = this.provider;
    if (!provider) return;
    provider.disconnect();
    this.update({ connected: false });
  };

  private onOnline = () => {
    if (this.waitingForNetwork) {
      this.clearRetry();
      this.connect();
      return;
    }
    if (this.snapshot.connected || this.snapshot.forbidden || this.retryTimer)
      return;
    void this.provider?.connect();
  };

  private assertWritable(): void {
    if (!this.acceptsWrites)
      throw new Error("The collaborative document is not writable.");
  }

  private update(patch: Partial<CanvasDocumentSnapshot>): void {
    if (this.destroyed) return;
    this.snapshot = { ...this.snapshot, ...patch };
    for (const listener of this.listeners) listener();
  }

  private attachDocument(): void {
    this.doc = createCanvasYDoc();
    this.items = documentItems(this.doc);
    this.items.observeDeep(this.onItemsChanged);
    this.doc.on("update", this.onDocumentUpdate);
  }

  private detachDocument(): void {
    this.items.unobserveDeep(this.onItemsChanged);
    this.doc.off("update", this.onDocumentUpdate);
    this.doc.destroy();
  }

  private connect(): void {
    if (this.destroyed) return;
    // Opened without a network (a reload while offline): wait for the
    // browser's online event instead of dialling the sync server, and check
    // again after the retry delay in case the event never comes (Firefox
    // skips it for a page that loaded offline).
    if (typeof navigator !== "undefined" && navigator.onLine === false) {
      this.waitingForNetwork = true;
      if (!this.retryTimer)
        this.retryTimer = setTimeout(() => {
          this.retryTimer = null;
          this.connect();
        }, this.options.retryDelayMs ?? 2_000);
      return;
    }
    this.waitingForNetwork = false;
    const provider: HocuspocusProvider = new HocuspocusProvider({
      url: this.options.url,
      name: this.canvasId,
      document: this.doc,
      // Browsers authenticate with the session cookie. The token is the
      // public share token, needed only to open a public canvas the user
      // neither owns nor was shared.
      token: this.options.shareToken ?? "",
      // Batch keystrokes: each batch is one stored, acknowledged update.
      flushDelay: 150,
      ...(this.options.WebSocketPolyfill
        ? { WebSocketPolyfill: this.options.WebSocketPolyfill }
        : {}),
      onConnect: () => {
        // Runs before the provider sends the edits it queued while offline.
        // Edits kept by an earlier page (a reload without a network) are in
        // the device copy, not in that queue, and the server refuses an edit
        // that builds on changes it lacks. The handshake's sync step 2
        // answers the server's state vector with exactly the changes it
        // lacks (queued and device-copy edits alike), so drop the queued
        // edits instead of sending them, or the whole document, ahead of it.
        if (this.provider !== provider || this.snapshot.unsavedChanges === 0)
          return;
        dropQueuedDocumentUpdates(provider);
      },
      onStatus: ({ status }) => {
        if (this.provider === provider)
          this.update({ connected: status === "connected" });
      },
      onAuthenticated: ({ scope }) => {
        if (this.provider !== provider) return;
        const writable = scope === "read-write";
        if (this.snapshot.writable && !writable) {
          // Edit access is gone: local changes the server has not stored can
          // never be stored, so start again from the server's copy.
          this.later(() => this.reset());
          return;
        }
        if (this.snapshot.writable === writable) return;
        this.update({ writable });
        this.writeCache((cache) => cache.saveMeta(this.cacheMeta()));
      },
      onAuthenticationFailed: ({ reason }) => {
        if (this.provider !== provider) return;
        this.later(() =>
          reason === SYNC_CLOSE_REASONS.unavailable
            ? this.retry()
            : this.forbid(),
        );
      },
      onSynced: ({ state }) => {
        if (this.provider !== provider || !state) return;
        this.retryAttempts = 0;
        if (this.snapshot.sendBlocked) this.update({ sendBlocked: false });
        if (!this.snapshot.ready || this.snapshot.restored)
          this.update({ ready: true, restored: false });
      },
      onUnsyncedChanges: ({ number }) => {
        if (this.provider !== provider) return;
        // The server acknowledges only after storing, and the handshake on
        // every (re)connect sends it whatever it lacks: at zero, every local
        // edit made so far is stored.
        if (number === 0 && this.snapshot.unsavedChanges > 0) {
          this.update({ pendingChanges: 0, unsavedChanges: 0 });
          this.writeCache((cache) => cache.saveMeta(this.cacheMeta()));
        } else {
          this.update({ pendingChanges: number });
        }
      },
      onClose: ({ event }) => {
        if (this.provider !== provider) return;
        const reason = event?.reason;
        if (reason === SYNC_CLOSE_REASONS.invalidUpdate)
          this.later(() => this.reset(this.options.onRejectedChange));
        else if (reason === SYNC_CLOSE_REASONS.forbidden)
          this.later(() => this.forbid());
        else if (reason === SYNC_CLOSE_REASONS.unavailable)
          this.later(() => this.retry());
        else if (reason === SYNC_CLOSE_REASONS.reauthenticate)
          this.later(() => this.reauthenticate());
        else if (event?.code === MESSAGE_TOO_BIG_CLOSE_CODE)
          // A message over the server's frame limit: resending at once would
          // fail the same way. Keep the device copy and back off.
          this.later(() => {
            this.update({ sendBlocked: true });
            this.retry();
          });
      },
    });
    this.provider = provider;
  }

  /** Leave provider callbacks before replacing the provider. */
  private later(action: () => void): void {
    queueMicrotask(() => {
      if (!this.destroyed) action();
    });
  }

  private disconnect(): void {
    const provider = this.provider;
    this.provider = null;
    provider?.destroy();
  }

  private clearRetry(): void {
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.retryTimer = null;
  }

  /** Reconnect with the same document, so unacknowledged changes are resent. */
  private retry(): void {
    if (this.retryTimer || this.snapshot.forbidden) return;
    this.disconnect();
    this.update({ connected: false });
    // Grow the delay while connections keep failing, up to a cap; a sync
    // resets it.
    const base = this.options.retryDelayMs ?? 2_000;
    const delay = Math.min(
      base * 2 ** this.retryAttempts,
      Math.max(base, MAX_RETRY_DELAY_MS),
    );
    this.retryAttempts += 1;
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      this.connect();
    }, delay);
  }

  private reauthenticate(): void {
    this.clearRetry();
    this.disconnect();
    this.update({
      connected: false,
      accessRevision: this.snapshot.accessRevision + 1,
    });
    this.connect();
  }

  private forbid(): void {
    this.clearRetry();
    this.disconnect();
    // Without access the device copy can never be stored: drop it, and keep
    // no other.
    this.clearCache();
    this.cacheStopped = true;
    this.update({
      forbidden: true,
      writable: false,
      connected: false,
      unsavedChanges: 0,
      restored: false,
      accessRevision: this.snapshot.accessRevision + 1,
    });
  }

  /** Drop the local document and load the server's copy. */
  private reset(notify?: () => void): void {
    this.clearRetry();
    this.disconnect();
    this.detachDocument();
    // The device copy holds the discarded changes too. The clear is queued
    // ahead of every write of the new document, so they never come back.
    this.clearCache();
    this.attachDocument();
    this.update({
      ready: false,
      writable: false,
      connected: false,
      pendingChanges: 0,
      unsavedChanges: 0,
      restored: false,
      localChanges: false,
      generation: this.snapshot.generation + 1,
      items: new Map(),
    });
    notify?.();
    this.connect();
  }

  /** Open with the device copy, if there is one, then connect. */
  private async restore(cache: CanvasDocumentCache): Promise<void> {
    let stored = null;
    try {
      stored = await cache.load();
    } catch {
      // IndexedDB is unavailable (private mode, quota): stay online-only.
      this.cacheStopped = true;
    }
    if (this.destroyed) return;
    if (stored && stored.updates.length > 0) {
      try {
        Y.applyUpdate(this.doc, Y.mergeUpdates(stored.updates), CACHE_ORIGIN);
        this.update({
          ready: true,
          restored: true,
          writable: stored.writable,
          unsavedChanges: stored.unsavedChanges,
          canvasName: this.snapshot.canvasName ?? stored.canvasName,
        });
      } catch {
        // An unreadable copy: start again from the server's.
        this.detachDocument();
        this.clearCache();
        this.attachDocument();
        this.update({ items: new Map() });
      }
    }
    this.connect();
  }

  private cacheMeta(): CanvasDocumentCacheMeta {
    return {
      writable: this.snapshot.writable,
      unsavedChanges: this.snapshot.unsavedChanges,
      canvasName: this.snapshot.canvasName,
    };
  }

  private writeCache(
    write: (cache: CanvasDocumentCache) => Promise<void>,
  ): void {
    const cache = this.cache;
    if (!cache || this.cacheStopped) return;
    this.cacheWrites = write(cache).catch(() => {
      // Quota or a closed database: keep editing online-only. What is stored
      // stays a consistent, older copy.
      this.cacheStopped = true;
    });
  }

  private clearCache(): void {
    const cache = this.cache;
    if (!cache) return;
    this.updatesSinceCompaction = 0;
    this.cacheWrites = cache.clear().catch(() => {
      this.cacheStopped = true;
    });
  }

  private persistUpdate(update: Uint8Array): void {
    if (!this.cache || this.cacheStopped) return;
    this.updatesSinceCompaction += 1;
    if (
      this.updatesSinceCompaction >= (this.options.cacheCompactAfter ?? 100)
    ) {
      this.updatesSinceCompaction = 0;
      const state = Y.encodeStateAsUpdate(this.doc);
      this.writeCache((cache) => cache.compact(state, this.cacheMeta()));
    } else {
      this.writeCache((cache) => cache.append(update, this.cacheMeta()));
    }
  }

  private onDocumentUpdate = (update: Uint8Array, origin: unknown) => {
    if (origin === CACHE_ORIGIN) return;
    // Updates applied by the provider come from the server; anything else
    // (canvas writes, the note editor) is a local change.
    if (origin !== this.provider && this.snapshot.ready)
      this.update({
        localChanges: true,
        unsavedChanges: this.snapshot.unsavedChanges + 1,
      });
    this.persistUpdate(update);
  };

  private onItemsChanged = (
    events: Array<Y.YEvent<Y.AbstractType<unknown>>>,
  ) => {
    const touched = new Set<string>();
    for (const event of events) {
      if (event.target === (this.items as unknown)) {
        for (const key of event.changes.keys.keys()) touched.add(key);
      } else if (typeof event.path[0] === "string") {
        touched.add(event.path[0]);
      }
    }
    if (touched.size === 0) return;
    const entries = new Map(this.snapshot.items);
    const changedAt = this.snapshot.ready ? new Date() : null;
    for (const id of touched) {
      const state = readItemState(id, this.items.get(id));
      if (state) entries.set(id, { state, changedAt });
      else entries.delete(id);
    }
    this.update({ items: entries });
  };
}
