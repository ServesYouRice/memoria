/**
 * IMP-045 — the device copy of collaborative canvas documents, so an editor
 * can keep working through a lost connection and a reload.
 *
 * One IndexedDB database per browser profile holds, per signed-in user and
 * canvas, the document's compacted Yjs state, the updates appended since, and
 * a small record: the last scope the sync server granted, the number of local
 * edits it has not confirmed storing yet, and the canvas name for the header.
 * The browser session (`client-session.ts`) is the only writer.
 *
 * Privacy: the copy belongs to one user at a time. Records are keyed by user
 * id, a different user claiming the cache wipes it first, and signing out
 * clears it together with the cached canvas page shells the service worker
 * serves offline. Nothing here is a security boundary: the sync server
 * validates and authorizes every update a restored copy sends.
 *
 * @module lib/collaboration/sync/offline-store
 */

import { mergeUpdates } from "yjs";

export const OFFLINE_DATABASE_NAME = "memoria-offline";
const DATABASE_VERSION = 1;

const DOCUMENTS = "documents";
const STATES = "states";
const UPDATES = "updates";
const OWNER = "owner";
const UPDATES_BY_DOCUMENT = "by-document";
const OWNER_KEY = "owner";

/**
 * Cache Storage bucket for canvas page shells (no user data). `public/sw.js`
 * serves a shell from it when a canvas is opened without a network; keep the
 * two names in step.
 */
export const CANVAS_SHELL_CACHE = "memoria-canvas-shells-v1";
// Keep in step with CACHE_NAME in public/sw.js.
export const PUBLIC_ASSET_CACHE = "memoria-public-v2";

/** Device copies kept beyond this many are pruned, oldest first, once synced. */
export const MAX_CACHED_CANVASES = 30;

export interface CanvasDocumentCacheMeta {
  /** The sync server last accepted this user's changes (owner or editor). */
  writable: boolean;
  /** Local edits the sync server has not confirmed storing. */
  unsavedChanges: number;
  canvasName: string | null;
}

export interface CachedCanvasDocument extends CanvasDocumentCacheMeta {
  /** The compacted state followed by every update appended since. */
  updates: Uint8Array[];
  savedAt: number;
}

/** The device copy of one canvas for one user. */
export interface CanvasDocumentCache {
  load(): Promise<CachedCanvasDocument | null>;
  /** Append one document update. */
  append(update: Uint8Array, meta: CanvasDocumentCacheMeta): Promise<void>;
  saveMeta(meta: CanvasDocumentCacheMeta): Promise<void>;
  /** Replace what this cache wrote or loaded with the whole document state. */
  compact(state: Uint8Array, meta: CanvasDocumentCacheMeta): Promise<void>;
  /** Drop the copy. Later writes start a new one. */
  clear(): Promise<void>;
}

interface DocumentRecord extends CanvasDocumentCacheMeta {
  userId: string;
  canvasId: string;
  savedAt: number;
}

interface UpdateRecord {
  userId: string;
  canvasId: string;
  update: Uint8Array;
}

type DocumentKey = [string, string];

function hasIndexedDb(): boolean {
  return typeof indexedDB !== "undefined";
}

function result<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function completion(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () =>
      reject(transaction.error ?? new Error("IndexedDB transaction aborted"));
  });
}

let database: Promise<IDBDatabase> | null = null;

function openDatabase(): Promise<IDBDatabase> {
  if (database) return database;
  const opening = new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(OFFLINE_DATABASE_NAME, DATABASE_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      db.createObjectStore(DOCUMENTS);
      db.createObjectStore(STATES);
      db.createObjectStore(UPDATES, { autoIncrement: true }).createIndex(
        UPDATES_BY_DOCUMENT,
        ["userId", "canvasId"],
      );
      db.createObjectStore(OWNER);
    };
    request.onsuccess = () => {
      const db = request.result;
      // Let another tab upgrade or delete the database.
      db.onversionchange = () => {
        db.close();
        if (database === opening) database = null;
      };
      db.onclose = () => {
        if (database === opening) database = null;
      };
      resolve(db);
    };
    request.onerror = () => reject(request.error);
    request.onblocked = () =>
      reject(new Error("The offline database is blocked by another tab."));
  });
  database = opening;
  opening.catch(() => {
    if (database === opening) database = null;
  });
  return opening;
}

/** Delete every update of one document; runs inside `transaction`. */
async function deleteDocumentUpdates(
  updates: IDBObjectStore,
  key: DocumentKey,
): Promise<void> {
  const ids = await result(
    updates.index(UPDATES_BY_DOCUMENT).getAllKeys(IDBKeyRange.only(key)),
  );
  for (const id of ids) updates.delete(id);
}

class IndexedDbCanvasDocumentCache implements CanvasDocumentCache {
  private readonly key: DocumentKey;
  /** Updates this instance loaded or wrote; compaction folds only these. */
  private known: IDBValidKey[] = [];
  /** Writes run one at a time, in call order. */
  private tail: Promise<unknown> = Promise.resolve();

  constructor(
    private readonly userId: string,
    private readonly canvasId: string,
  ) {
    this.key = [userId, canvasId];
  }

  private serial<T>(work: (db: IDBDatabase) => Promise<T>): Promise<T> {
    const next = this.tail.then(
      () => openDatabase().then(work),
      () => openDatabase().then(work),
    );
    this.tail = next.catch(() => undefined);
    return next;
  }

  private record(meta: CanvasDocumentCacheMeta): DocumentRecord {
    return {
      userId: this.userId,
      canvasId: this.canvasId,
      writable: meta.writable,
      unsavedChanges: meta.unsavedChanges,
      canvasName: meta.canvasName,
      savedAt: Date.now(),
    };
  }

  load(): Promise<CachedCanvasDocument | null> {
    return this.serial(async (db) => {
      const transaction = db.transaction(
        [DOCUMENTS, STATES, UPDATES],
        "readonly",
      );
      const done = completion(transaction);
      const byDocument = transaction
        .objectStore(UPDATES)
        .index(UPDATES_BY_DOCUMENT);
      const [record, state, ids, updates] = await Promise.all([
        result(
          transaction.objectStore(DOCUMENTS).get(this.key) as IDBRequest<
            DocumentRecord | undefined
          >,
        ),
        result(
          transaction.objectStore(STATES).get(this.key) as IDBRequest<
            Uint8Array | undefined
          >,
        ),
        result(byDocument.getAllKeys(IDBKeyRange.only(this.key))),
        result(
          byDocument.getAll(IDBKeyRange.only(this.key)) as IDBRequest<
            UpdateRecord[]
          >,
        ),
      ]);
      await done;
      if (!record || record.userId !== this.userId) return null;
      this.known = ids;
      return {
        writable: record.writable,
        unsavedChanges: record.unsavedChanges,
        canvasName: record.canvasName,
        savedAt: record.savedAt,
        updates: [
          ...(state ? [state] : []),
          ...updates.map((entry) => entry.update),
        ],
      };
    });
  }

  append(update: Uint8Array, meta: CanvasDocumentCacheMeta): Promise<void> {
    return this.serial(async (db) => {
      const transaction = db.transaction([DOCUMENTS, UPDATES], "readwrite");
      const done = completion(transaction);
      const entry: UpdateRecord = {
        userId: this.userId,
        canvasId: this.canvasId,
        update,
      };
      const id = transaction.objectStore(UPDATES).add(entry);
      transaction.objectStore(DOCUMENTS).put(this.record(meta), this.key);
      this.known.push(await result(id));
      await done;
    });
  }

  saveMeta(meta: CanvasDocumentCacheMeta): Promise<void> {
    return this.serial(async (db) => {
      const transaction = db.transaction(DOCUMENTS, "readwrite");
      const done = completion(transaction);
      transaction.objectStore(DOCUMENTS).put(this.record(meta), this.key);
      await done;
    });
  }

  compact(state: Uint8Array, meta: CanvasDocumentCacheMeta): Promise<void> {
    return this.serial(async (db) => {
      const transaction = db.transaction(
        [DOCUMENTS, STATES, UPDATES],
        "readwrite",
      );
      const done = completion(transaction);
      const states = transaction.objectStore(STATES);
      // Every tab of this user shares one compacted state. Another tab may
      // have compacted edits this document never received, so merge into the
      // stored state instead of replacing it (merging Yjs updates loses
      // nothing). The read and the write share one readwrite transaction, so
      // a compaction in another tab cannot run between them.
      const existing = (await result(states.get(this.key))) as
        | Uint8Array
        | undefined;
      let merged = state;
      if (existing) {
        try {
          merged = mergeUpdates([existing, state]);
        } catch {
          // An unreadable stored state cannot be merged; this document's
          // state replaces it, as before.
        }
      }
      states.put(merged, this.key);
      // Another tab may have appended updates this document has not seen;
      // they stay and are applied again on load (Yjs ignores duplicates).
      const updates = transaction.objectStore(UPDATES);
      for (const id of this.known) updates.delete(id);
      transaction.objectStore(DOCUMENTS).put(this.record(meta), this.key);
      await done;
      this.known = [];
    });
  }

  // This deletes every update row of the canvas, including rows another tab
  // appended. Right on the forbid path (access is gone); whether the reset
  // path should keep other tabs' rows is open (plan question Q-004 of section
  // 7878a3ed849f8bf4ae43d821), so it is unchanged.
  clear(): Promise<void> {
    return this.serial(async (db) => {
      const transaction = db.transaction(
        [DOCUMENTS, STATES, UPDATES],
        "readwrite",
      );
      const done = completion(transaction);
      transaction.objectStore(DOCUMENTS).delete(this.key);
      transaction.objectStore(STATES).delete(this.key);
      await deleteDocumentUpdates(transaction.objectStore(UPDATES), this.key);
      await done;
      this.known = [];
    });
  }
}

/** The device copy of `canvasId` for `userId`, or null without IndexedDB. */
export function openCanvasDocumentCache(
  userId: string,
  canvasId: string,
): CanvasDocumentCache | null {
  if (!hasIndexedDb() || !userId || !canvasId) return null;
  return new IndexedDbCanvasDocumentCache(userId, canvasId);
}

async function deleteCanvasShells(): Promise<void> {
  if (typeof caches === "undefined") return;
  await caches.delete(CANVAS_SHELL_CACHE);
}

async function clearAllStores(db: IDBDatabase): Promise<void> {
  const transaction = db.transaction(
    [DOCUMENTS, STATES, UPDATES, OWNER],
    "readwrite",
  );
  const done = completion(transaction);
  for (const name of [DOCUMENTS, STATES, UPDATES, OWNER])
    transaction.objectStore(name).clear();
  await done;
}

/** The user the device copies belong to, for opening a canvas offline. */
export async function readOfflineCacheOwner(): Promise<string | null> {
  if (!hasIndexedDb()) return null;
  const db = await openDatabase();
  const transaction = db.transaction(OWNER, "readonly");
  const owner = (await result(
    transaction.objectStore(OWNER).get(OWNER_KEY),
  )) as string | undefined;
  return typeof owner === "string" ? owner : null;
}

/**
 * Make `userId` the owner of the device copies. Copies of anyone else are
 * deleted first, so one browser never shows one user's canvases to another.
 */
export async function claimOfflineCache(userId: string): Promise<void> {
  if (!hasIndexedDb() || !userId) return;
  const db = await openDatabase();
  const transaction = db.transaction(
    [DOCUMENTS, STATES, UPDATES, OWNER],
    "readwrite",
  );
  const done = completion(transaction);
  const owners = transaction.objectStore(OWNER);
  const owner = await result(owners.get(OWNER_KEY));
  let replaced = false;
  if (owner !== userId) {
    replaced = owner !== undefined;
    for (const name of [DOCUMENTS, STATES, UPDATES])
      transaction.objectStore(name).clear();
    owners.put(userId, OWNER_KEY);
  }
  await done;
  if (replaced) await deleteCanvasShells();
}

/**
 * Keep at most `MAX_CACHED_CANVASES` device copies: drop the oldest copies
 * that hold no unsaved changes, never `keep`.
 */
export async function pruneOfflineCache(
  options: { keep?: string; max?: number } = {},
): Promise<void> {
  if (!hasIndexedDb()) return;
  const max = options.max ?? MAX_CACHED_CANVASES;
  const db = await openDatabase();
  const transaction = db.transaction([DOCUMENTS, STATES, UPDATES], "readwrite");
  const done = completion(transaction);
  const documents = transaction.objectStore(DOCUMENTS);
  const records = (await result(documents.getAll())) as DocumentRecord[];
  if (records.length > max) {
    const removable = records
      .filter(
        (record) =>
          record.unsavedChanges === 0 && record.canvasId !== options.keep,
      )
      .sort((left, right) => left.savedAt - right.savedAt)
      .slice(0, records.length - max);
    for (const record of removable) {
      const key: DocumentKey = [record.userId, record.canvasId];
      documents.delete(key);
      transaction.objectStore(STATES).delete(key);
      await deleteDocumentUpdates(transaction.objectStore(UPDATES), key);
    }
  }
  await done;
}

/** Sign-out: delete every device copy and cached canvas page shell. */
export async function clearOfflineCache(): Promise<void> {
  const work: Promise<void>[] = [deleteCanvasShells()];
  if (hasIndexedDb()) work.push(openDatabase().then(clearAllStores));
  await Promise.all(work);
}

/**
 * Keep this canvas page's shell (HTML with no user data) so the service
 * worker can open the canvas again without a network. Online only.
 */
export async function rememberCanvasShell(pathname: string): Promise<void> {
  if (
    typeof caches === "undefined" ||
    typeof navigator === "undefined" ||
    !navigator.onLine ||
    !navigator.serviceWorker?.controller
  )
    return;
  const cache = await caches.open(CANVAS_SHELL_CACHE);
  const response = await fetch(pathname, {
    credentials: "same-origin",
    redirect: "manual",
  });
  if (!response.ok || response.type !== "basic") return;
  const html = await response.clone().text();
  await cache.put(pathname, response);
  await rememberShellAssets(html);
}

/**
 * Store the scripts and styles the shell needs in the service worker's public
 * cache. The worker caches assets as they pass through it, but WebKit serves a
 * reload's assets from its memory cache without asking the worker, so without
 * this an offline reload gets the shell and none of its code. Chunks the page
 * loads later on demand are stored as they arrive.
 */
async function rememberShellAssets(html: string): Promise<void> {
  const urls = new Set<string>();
  for (const match of html.matchAll(/["'](\/_next\/static\/[^"'\s#]+)/g))
    urls.add(match[1]!.replaceAll("&amp;", "&"));
  watchLoadedAssets();
  await storePublicAssets(urls);
}

let watchingLoadedAssets = false;

function watchLoadedAssets(): void {
  const origin = globalThis.location?.origin;
  if (
    watchingLoadedAssets ||
    !origin ||
    typeof PerformanceObserver === "undefined"
  )
    return;
  watchingLoadedAssets = true;
  new PerformanceObserver((list) => {
    const urls = new Set<string>();
    for (const entry of list.getEntries()) {
      const url = new URL(entry.name, origin);
      if (url.origin === origin && url.pathname.startsWith("/_next/static/"))
        urls.add(url.pathname + url.search);
    }
    void storePublicAssets(urls).catch(() => {});
  }).observe({ type: "resource", buffered: true });
}

async function storePublicAssets(urls: Set<string>): Promise<void> {
  if (urls.size === 0 || !navigator.onLine) return;
  const cache = await caches.open(PUBLIC_ASSET_CACHE);
  await Promise.all(
    [...urls].map(async (url) => {
      if (await cache.match(url)) return;
      const asset = await fetch(url, { credentials: "same-origin" });
      if (asset.ok && asset.type === "basic") await cache.put(url, asset);
    }),
  );
}
