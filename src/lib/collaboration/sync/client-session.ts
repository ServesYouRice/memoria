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
 * Framework-free; React binds it through `lib/hooks/use-canvas-document`.
 *
 * @module lib/collaboration/sync/client-session
 */

import type * as Y from "yjs";
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
  /** This client changed the document since the last reset. */
  localChanges: boolean;
  /** Access was refused or revoked; the canvas uses the HTTP API instead. */
  forbidden: boolean;
  /** Increments when a refused change or lost access replaced the document. */
  generation: number;
  /** Increments when the server reports a change in access. */
  accessRevision: number;
  items: ReadonlyMap<string, CanvasDocumentEntry>;
}

export interface CanvasDocumentSessionOptions {
  canvasId: string;
  /** WebSocket URL of the sync endpoint. */
  url: string;
  /** The server refused a local change; the document was reloaded. */
  onRejectedChange?: () => void;
  /** Delay before reconnecting after `memoria:unavailable`. */
  retryDelayMs?: number;
  /** Node test clients pass a cookie-carrying WebSocket implementation. */
  WebSocketPolyfill?: unknown;
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

const updateFieldsSchema = updateCanvasItemSchema.omit({ version: true });

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
    localChanges: false,
    forbidden: false,
    generation: 0,
    accessRevision: 0,
    items: new Map(),
  };
  private readonly listeners = new Set<() => void>();
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private destroyed = false;

  constructor(options: CanvasDocumentSessionOptions) {
    this.options = options;
    this.canvasId = options.canvasId;
    this.attachDocument();
    this.connect();
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
    this.clearRetry();
    this.disconnect();
    this.detachDocument();
    this.listeners.clear();
  }

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
    const provider: HocuspocusProvider = new HocuspocusProvider({
      url: this.options.url,
      name: this.canvasId,
      document: this.doc,
      // Browsers authenticate with the session cookie; the token is unused.
      token: "",
      // Batch keystrokes: each batch is one stored, acknowledged update.
      flushDelay: 150,
      ...(this.options.WebSocketPolyfill
        ? { WebSocketPolyfill: this.options.WebSocketPolyfill }
        : {}),
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
        this.update({ writable });
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
        if (this.provider === provider && state && !this.snapshot.ready)
          this.update({ ready: true });
      },
      onUnsyncedChanges: ({ number }) => {
        if (this.provider === provider) this.update({ pendingChanges: number });
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
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      this.connect();
    }, this.options.retryDelayMs ?? 2_000);
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
    this.update({
      forbidden: true,
      writable: false,
      connected: false,
      accessRevision: this.snapshot.accessRevision + 1,
    });
  }

  /** Drop the local document and load the server's copy. */
  private reset(notify?: () => void): void {
    this.clearRetry();
    this.disconnect();
    this.detachDocument();
    this.attachDocument();
    this.update({
      ready: false,
      writable: false,
      connected: false,
      pendingChanges: 0,
      localChanges: false,
      generation: this.snapshot.generation + 1,
      items: new Map(),
    });
    notify?.();
    this.connect();
  }

  private onDocumentUpdate = (_update: Uint8Array, origin: unknown) => {
    // Updates applied by the provider come from the server; anything else
    // (canvas writes, the note editor) is a local change.
    if (origin === this.provider || this.snapshot.localChanges) return;
    if (!this.snapshot.ready) return;
    this.update({ localChanges: true });
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
