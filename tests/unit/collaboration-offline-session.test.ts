/**
 * IMP-045: offline edits in the browser's canvas document session. The
 * Hocuspocus provider is replaced by a stand-in whose callbacks the tests
 * drive; the device copy is the real IndexedDB store (fake-indexeddb).
 */
import "fake-indexeddb/auto";
import * as Y from "yjs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const providers = vi.hoisted(() => {
  interface ProviderConfig {
    document: Y.Doc;
    onStatus: (data: { status: string }) => void;
    onAuthenticated: (data: { scope: string }) => void;
    onAuthenticationFailed: (data: { reason: string }) => void;
    onSynced: (data: { state: boolean }) => void;
    onUnsyncedChanges: (data: { number: number }) => void;
    onClose: (data: { event: { reason?: string } }) => void;
  }
  class FakeProvider {
    destroyed = false;
    connects = 0;
    constructor(readonly config: ProviderConfig) {
      created.push(this);
    }
    disconnects = 0;
    async connect() {
      this.connects += 1;
    }
    disconnect() {
      this.disconnects += 1;
    }
    destroy() {
      this.destroyed = true;
    }
  }
  const created: FakeProvider[] = [];
  return { FakeProvider, created };
});

vi.mock("@hocuspocus/provider", () => ({
  HocuspocusProvider: providers.FakeProvider,
}));

import { CanvasDocumentSession } from "@/lib/collaboration/sync/client-session";
import {
  type CanvasDocumentCache,
  clearOfflineCache,
  openCanvasDocumentCache,
} from "@/lib/collaboration/sync/offline-store";
import {
  applyItemState,
  documentItems,
} from "@/lib/collaboration/sync/document-items";
import {
  SYNC_CLOSE_REASONS,
  createCanvasItemId,
} from "@/lib/collaboration/sync/protocol";
import { ItemType } from "@/types/canvas";

const CANVAS_ID = "ckcanvas000000000000000001";
const sessions: CanvasDocumentSession[] = [];

function shape(positionX = 10) {
  return {
    canvasId: CANVAS_ID,
    type: ItemType.SHAPE,
    positionX,
    positionY: 20,
    width: 100,
    height: 100,
    content: { shapeType: "rectangle", fill: "#ffffff" },
  };
}

function open(
  options: {
    userId?: string;
    cache?: CanvasDocumentCache | null;
    onRejectedChange?: () => void;
    cacheCompactAfter?: number;
  } = {},
) {
  const session = new CanvasDocumentSession({
    canvasId: CANVAS_ID,
    url: "ws://sync.test/api/collaboration/sync",
    cache:
      options.cache === undefined
        ? openCanvasDocumentCache(options.userId ?? "user-a", CANVAS_ID)
        : options.cache,
    onRejectedChange: options.onRejectedChange,
    cacheCompactAfter: options.cacheCompactAfter,
    retryDelayMs: 1,
  });
  sessions.push(session);
  return session;
}

async function waitFor(check: () => boolean, timeoutMs = 2_000) {
  const deadline = Date.now() + timeoutMs;
  while (!check()) {
    if (Date.now() > deadline) throw new Error("Timed out waiting");
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

function latestProvider() {
  const provider = providers.created.at(-1);
  if (!provider) throw new Error("No provider was created");
  return provider;
}

/** What the server's sync handshake does for a client with edit access. */
function serverSyncs(state?: (doc: Y.Doc) => void) {
  const provider = latestProvider();
  const { config } = provider;
  config.onStatus({ status: "connected" });
  config.onAuthenticated({ scope: "read-write" });
  if (state) {
    const server = new Y.Doc();
    state(server);
    Y.applyUpdate(config.document, Y.encodeStateAsUpdate(server), provider);
  }
  config.onSynced({ state: true });
}

function goOffline() {
  latestProvider().config.onStatus({ status: "disconnected" });
}

/** A session that synced once online, so a writable copy is on the device. */
async function storeOnlineCopy(itemId = createCanvasItemId()) {
  const session = open();
  await waitFor(() => providers.created.length > 0);
  serverSyncs((server) => {
    applyItemState(documentItems(server), itemId, {
      id: itemId,
      type: ItemType.SHAPE,
      positionX: 1,
      positionY: 2,
      width: 50,
      height: 50,
      zIndex: 0,
      tags: [],
      content: { shapeType: "rectangle", fill: "#ffffff" },
    });
  });
  await waitFor(() => session.acceptsWrites);
  await session.whenCached();
  return { session, itemId };
}

beforeEach(async () => {
  providers.created.length = 0;
  vi.stubGlobal("caches", { delete: async () => true });
  await clearOfflineCache();
});

afterEach(() => {
  for (const session of sessions.splice(0)) session.destroy();
  vi.unstubAllGlobals();
});

describe("offline canvas document session", () => {
  it("keeps edits made offline on the device across a reload", async () => {
    const { session, itemId } = await storeOnlineCopy();
    goOffline();

    expect(session.acceptsWrites).toBe(true);
    const created = session.createItem(shape(30));
    session.updateItem(itemId, { positionX: 77 });
    expect(session.getSnapshot()).toMatchObject({
      connected: false,
      unsavedChanges: 2,
    });
    await session.whenCached();
    session.destroy();

    // The reload opens offline: no provider callback ever arrives.
    const reloaded = open();
    await waitFor(() => reloaded.getSnapshot().ready);
    const snapshot = reloaded.getSnapshot();
    expect(snapshot).toMatchObject({
      ready: true,
      restored: true,
      writable: true,
      connected: false,
      unsavedChanges: 2,
    });
    expect(snapshot.items.get(created.id)?.state.positionX).toBe(30);
    expect(snapshot.items.get(itemId)?.state.positionX).toBe(77);
    // Restored items render as loaded, not as fresh remote changes.
    expect(snapshot.items.get(itemId)?.changedAt).toBeNull();

    // Editing continues offline and counts on.
    expect(reloaded.acceptsWrites).toBe(true);
    reloaded.deleteItem(created.id);
    expect(reloaded.getSnapshot().unsavedChanges).toBe(3);
  });

  it("counts edits as saved once the server stores them after reconnecting", async () => {
    const { session, itemId } = await storeOnlineCopy();
    goOffline();
    session.updateItem(itemId, { positionY: 9 });
    await session.whenCached();
    session.destroy();

    const reloaded = open();
    await waitFor(() => reloaded.getSnapshot().restored);
    const provider = latestProvider();
    // The provider connects with the restored document, so the sync
    // handshake carries the offline edit.
    expect(provider.config.document.getMap("items").has(itemId)).toBe(true);
    serverSyncs();
    provider.config.onUnsyncedChanges({ number: 1 });
    expect(reloaded.getSnapshot().unsavedChanges).toBe(1);
    provider.config.onUnsyncedChanges({ number: 0 });
    expect(reloaded.getSnapshot()).toMatchObject({
      restored: false,
      unsavedChanges: 0,
      pendingChanges: 0,
    });
    await reloaded.whenCached();
    reloaded.destroy();

    const again = open();
    await waitFor(() => again.getSnapshot().ready);
    expect(again.getSnapshot().unsavedChanges).toBe(0);
    expect(again.getSnapshot().items.get(itemId)?.state.positionY).toBe(9);
  });

  it("discards the device copy when the server refuses an offline change", async () => {
    const { session } = await storeOnlineCopy();
    goOffline();
    const refused = session.createItem(shape(40));
    await session.whenCached();
    session.destroy();

    let rejected = 0;
    const reloaded = open({ onRejectedChange: () => (rejected += 1) });
    await waitFor(() => reloaded.getSnapshot().restored);
    const first = latestProvider();
    serverSyncs();
    first.config.onClose({
      event: { reason: SYNC_CLOSE_REASONS.invalidUpdate },
    });
    await waitFor(() => rejected === 1);

    expect(first.destroyed).toBe(true);
    expect(reloaded.getSnapshot()).toMatchObject({
      ready: false,
      restored: false,
      unsavedChanges: 0,
      generation: 1,
    });
    expect(reloaded.hasItem(refused.id)).toBe(false);
    // The new connection starts from an empty document, not the copy.
    const second = latestProvider();
    expect(second).not.toBe(first);
    expect(second.config.document.getMap("items").size).toBe(0);
    await reloaded.whenCached();
    reloaded.destroy();

    // Never resurrected: a later offline open has no copy at all.
    const offline = open();
    await waitFor(() => providers.created.length === 3);
    expect(offline.getSnapshot().ready).toBe(false);
    expect(offline.hasItem(refused.id)).toBe(false);
  });

  it("discards the device copy when access is revoked", async () => {
    const { session } = await storeOnlineCopy();
    goOffline();
    session.createItem(shape(50));
    await session.whenCached();
    session.destroy();

    const reloaded = open();
    await waitFor(() => reloaded.getSnapshot().restored);
    latestProvider().config.onAuthenticationFailed({
      reason: SYNC_CLOSE_REASONS.forbidden,
    });
    await waitFor(() => reloaded.getSnapshot().forbidden);
    expect(reloaded.getSnapshot()).toMatchObject({
      writable: false,
      unsavedChanges: 0,
    });
    expect(reloaded.acceptsWrites).toBe(false);
    await reloaded.whenCached();
    reloaded.destroy();

    const offline = open();
    await waitFor(() => providers.created.length === 3);
    expect(offline.getSnapshot().ready).toBe(false);
  });

  it("discards the device copy when the user may no longer edit", async () => {
    const { session } = await storeOnlineCopy();
    goOffline();
    const pending = session.createItem(shape(60));
    await session.whenCached();
    session.destroy();

    const reloaded = open();
    await waitFor(() => reloaded.getSnapshot().restored);
    const provider = latestProvider();
    provider.config.onStatus({ status: "connected" });
    provider.config.onAuthenticated({ scope: "readonly" });
    await waitFor(() => reloaded.getSnapshot().generation === 1);
    expect(reloaded.hasItem(pending.id)).toBe(false);
    expect(reloaded.getSnapshot().unsavedChanges).toBe(0);

    // The view-only copy that follows is kept, read-only.
    const viewer = latestProvider();
    viewer.config.onStatus({ status: "connected" });
    viewer.config.onAuthenticated({ scope: "readonly" });
    const server = new Y.Doc();
    server.getMap("items").set("cserveritem00000000000001", new Y.Map());
    Y.applyUpdate(
      viewer.config.document,
      Y.encodeStateAsUpdate(server),
      viewer,
    );
    viewer.config.onSynced({ state: true });
    await waitFor(() => reloaded.getSnapshot().ready);
    expect(reloaded.acceptsWrites).toBe(false);
    await reloaded.whenCached();
    reloaded.destroy();
    const offline = open();
    await waitFor(() => offline.getSnapshot().ready);
    expect(offline.hasItem(pending.id)).toBe(false);
    expect(offline.acceptsWrites).toBe(false);
  });

  it("never opens another user's copy", async () => {
    const { session, itemId } = await storeOnlineCopy();
    session.destroy();

    const other = open({ userId: "user-b" });
    await waitFor(() => providers.created.length === 2);
    expect(other.getSnapshot().ready).toBe(false);
    expect(other.hasItem(itemId)).toBe(false);
  });

  it("keeps working online-only when the device copy cannot be read", async () => {
    const broken: CanvasDocumentCache = {
      load: () => Promise.reject(new Error("IndexedDB unavailable")),
      append: vi.fn(() => Promise.resolve()),
      saveMeta: vi.fn(() => Promise.resolve()),
      compact: vi.fn(() => Promise.resolve()),
      clear: vi.fn(() => Promise.resolve()),
    };
    const session = open({ cache: broken });
    await waitFor(() => providers.created.length === 1);
    serverSyncs();
    await waitFor(() => session.acceptsWrites);
    session.createItem(shape());
    expect(broken.append).not.toHaveBeenCalled();
  });

  it("restores the same document after compacting the copy", async () => {
    const session = open({ cacheCompactAfter: 3 });
    await waitFor(() => providers.created.length === 1);
    serverSyncs();
    await waitFor(() => session.acceptsWrites);
    const ids = [1, 2, 3, 4, 5].map(
      (index) => session.createItem(shape(index * 10)).id,
    );
    await session.whenCached();
    session.destroy();

    const reloaded = open({ cacheCompactAfter: 3 });
    await waitFor(() => reloaded.getSnapshot().ready);
    expect(
      ids.map((id) => reloaded.getSnapshot().items.get(id)?.state.positionX),
    ).toEqual([10, 20, 30, 40, 50]);
    expect(reloaded.getSnapshot().unsavedChanges).toBe(5);
  });

  it("keeps the canvas name with the copy for an offline open", async () => {
    const { session } = await storeOnlineCopy();
    session.rememberCanvasName("Roadmap");
    await session.whenCached();
    session.destroy();

    const reloaded = open();
    await waitFor(() => reloaded.getSnapshot().ready);
    expect(reloaded.getSnapshot().canvasName).toBe("Roadmap");
  });

  it("keeps no copy without a signed-in user", async () => {
    const session = open({ cache: null });
    // Connects at once, without waiting for a device copy.
    expect(providers.created).toHaveLength(1);
    serverSyncs();
    await waitFor(() => session.acceptsWrites);
    expect(session.getSnapshot().restored).toBe(false);
  });

  it("follows the browser's offline and online events", async () => {
    const browser = new EventTarget();
    vi.stubGlobal("window", browser);
    const { session, itemId } = await storeOnlineCopy();
    const provider = latestProvider();

    // Offline: stop at once, keep editing on the device.
    browser.dispatchEvent(new Event("offline"));
    expect(provider.disconnects).toBe(1);
    expect(session.getSnapshot().connected).toBe(false);
    session.updateItem(itemId, { positionX: 5 });
    expect(session.getSnapshot().unsavedChanges).toBe(1);

    // Online: reconnect without waiting for the provider's back-off.
    browser.dispatchEvent(new Event("online"));
    expect(provider.connects).toBe(1);

    // Connected, or destroyed: nothing to do.
    provider.config.onStatus({ status: "connected" });
    browser.dispatchEvent(new Event("online"));
    session.destroy();
    browser.dispatchEvent(new Event("online"));
    expect(provider.connects).toBe(1);
  });
});
