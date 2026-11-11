/**
 * TASK-167: a close for a message over the server's frame limit (WebSocket
 * code 1009, no memoria reason) must not loop straight back into the same
 * oversized send: the session backs off, keeps the device copy and its
 * unsaved edits, and reports the condition.
 */
import "fake-indexeddb/auto";
import type * as Y from "yjs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const providers = vi.hoisted(() => {
  interface ProviderConfig {
    document: Y.Doc;
    onStatus: (data: { status: string }) => void;
    onAuthenticated: (data: { scope: string }) => void;
    onSynced: (data: { state: boolean }) => void;
    onClose: (data: { event: { code?: number; reason?: string } }) => void;
  }
  class FakeProvider {
    destroyed = false;
    constructor(readonly config: ProviderConfig) {
      created.push({ provider: this, at: Date.now() });
    }
    destroy() {
      this.destroyed = true;
    }
  }
  const created: Array<{ provider: FakeProvider; at: number }> = [];
  return { FakeProvider, created };
});

vi.mock("@hocuspocus/provider", () => ({
  HocuspocusProvider: providers.FakeProvider,
}));

import { CanvasDocumentSession } from "@/lib/collaboration/sync/client-session";
import {
  clearOfflineCache,
  openCanvasDocumentCache,
} from "@/lib/collaboration/sync/offline-store";
import { ItemType } from "@/types/canvas";

const CANVAS_ID = "ckcanvas000000000000000167";
const RETRY_MS = 20;
const sessions: CanvasDocumentSession[] = [];

function open() {
  const session = new CanvasDocumentSession({
    canvasId: CANVAS_ID,
    url: "ws://sync.test/api/collaboration/sync",
    cache: openCanvasDocumentCache("user-a", CANVAS_ID),
    retryDelayMs: RETRY_MS,
  });
  sessions.push(session);
  return session;
}

async function waitFor(check: () => boolean, timeoutMs = 3_000) {
  const deadline = Date.now() + timeoutMs;
  while (!check()) {
    if (Date.now() > deadline) throw new Error("Timed out waiting");
    await new Promise((resolve) => setTimeout(resolve, 2));
  }
}

function latest() {
  const entry = providers.created.at(-1);
  if (!entry) throw new Error("No provider was created");
  return entry.provider;
}

function closeTooBig() {
  latest().config.onStatus({ status: "disconnected" });
  latest().config.onClose({ event: { code: 1009, reason: "" } });
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

describe("oversized-frame close", () => {
  it("backs off between reconnects and keeps the unsaved edits", async () => {
    const session = open();
    await waitFor(() => providers.created.length === 1);
    const { config } = latest();
    config.onStatus({ status: "connected" });
    config.onAuthenticated({ scope: "read-write" });
    config.onSynced({ state: true });
    await waitFor(() => session.acceptsWrites);
    config.onStatus({ status: "disconnected" });
    const created = session.createItem({
      canvasId: CANVAS_ID,
      type: ItemType.SHAPE,
      positionX: 5,
      positionY: 5,
      width: 10,
      height: 10,
      content: { shapeType: "rectangle", fill: "#ffffff" },
    });
    await session.whenCached();

    // Three oversized-frame closes in a row.
    for (let attempt = 1; attempt <= 3; attempt++) {
      const before = providers.created.length;
      const closedAt = Date.now();
      closeTooBig();
      await waitFor(() => providers.created.length === before + 1);
      const waited = providers.created.at(-1)!.at - closedAt;
      // The delay grows: RETRY_MS, 2x, 4x (minus timer slack).
      expect(waited).toBeGreaterThanOrEqual(RETRY_MS * 2 ** (attempt - 1) - 5);
      expect(providers.created.at(-2)!.provider.destroyed).toBe(true);
    }

    const snapshot = session.getSnapshot();
    expect(snapshot.sendBlocked).toBe(true);
    expect(snapshot.unsavedChanges).toBe(1);
    expect(snapshot.forbidden).toBe(false);
    expect(snapshot.items.has(created.id)).toBe(true);

    // The device copy still holds the edit.
    await session.whenCached();
    session.destroy();
    const reloaded = open();
    await waitFor(() => reloaded.getSnapshot().restored);
    expect(reloaded.getSnapshot().unsavedChanges).toBe(1);
    expect(reloaded.getSnapshot().items.has(created.id)).toBe(true);
  });

  it("clears the condition once a connection syncs", async () => {
    const session = open();
    await waitFor(() => providers.created.length === 1);
    closeTooBig();
    await waitFor(() => providers.created.length === 2);
    expect(session.getSnapshot().sendBlocked).toBe(true);
    latest().config.onStatus({ status: "connected" });
    latest().config.onSynced({ state: true });
    expect(session.getSnapshot().sendBlocked).toBe(false);
  });
});
