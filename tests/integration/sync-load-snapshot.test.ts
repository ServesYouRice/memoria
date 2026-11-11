/**
 * TASK-161 — loading a canvas document reads the compacted state and the
 * update log from one snapshot, so a compaction committed between the two
 * reads cannot drop updates from the loaded document.
 */

import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/cache/redis-client", () => ({ getRedisClient: () => null }));

import * as Y from "yjs";
import type { PrismaClient } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import {
  appendCanvasDocumentUpdate,
  compactCanvasDocument,
  readPersistedCanvasDocument,
  toBytes,
} from "@/lib/collaboration/sync/store";
import {
  applyItemState,
  createCanvasYDoc,
  documentItems,
} from "@/lib/collaboration/sync/document-items";
import { createCanvasItemId } from "@/lib/collaboration/sync/protocol";
import { ItemType } from "@/types/canvas";

function shape(id: string) {
  return {
    id,
    type: ItemType.SHAPE,
    positionX: 0,
    positionY: 0,
    width: 10,
    height: 10,
    zIndex: 0,
    tags: [],
    content: { shapeType: "star" },
  };
}

/** Add an item to `doc` and return the update that did it. */
function addItem(doc: Y.Doc, id: string): Uint8Array {
  const vector = Y.encodeStateVector(doc);
  doc.transact(() => applyItemState(documentItems(doc), id, shape(id)));
  return Y.encodeStateAsUpdate(doc, vector);
}

/**
 * A client whose first canvasDocument.findUnique (on itself or on any
 * transaction it opens) runs `afterStateRead` before returning.
 */
function pausingClient(afterStateRead: () => Promise<void>): PrismaClient {
  let paused = false;
  const wrapStore = <T extends object>(store: T): T =>
    new Proxy(store, {
      get(target, key, receiver) {
        const value = Reflect.get(target, key, receiver);
        if (key === "canvasDocument")
          return new Proxy(value as object, {
            get(model, method, r) {
              const fn = Reflect.get(model, method, r);
              if (method !== "findUnique" || typeof fn !== "function")
                return fn;
              return async (...args: unknown[]) => {
                const result = await fn.apply(model, args);
                if (!paused) {
                  paused = true;
                  await afterStateRead();
                }
                return result;
              };
            },
          });
        if (key === "$transaction" && typeof value === "function")
          return (callback: unknown, options: unknown) =>
            typeof callback === "function"
              ? value.call(
                  target,
                  (tx: object) => callback(wrapStore(tx)),
                  options,
                )
              : value.call(target, callback, options);
        return typeof value === "function" ? value.bind(target) : value;
      },
    });
  return wrapStore(prisma);
}

beforeEach(async () => {
  await prisma.canvas.deleteMany({
    where: { user: { email: { startsWith: "snapshot-" } } },
  });
  await prisma.user.deleteMany({
    where: { email: { startsWith: "snapshot-" } },
  });
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("readPersistedCanvasDocument snapshot", () => {
  it("keeps every update when another replica compacts mid-load", async () => {
    const owner = await prisma.user.create({
      data: { email: `snapshot-${Date.now()}@example.com` },
    });
    const canvas = await prisma.canvas.create({
      data: { name: "Snapshot", userId: owner.id },
    });
    const canvasId = canvas.id;
    const [a, b, c, d] = Array.from({ length: 4 }, createCanvasItemId);

    // The other replica's copy of the document.
    const replica = createCanvasYDoc();
    addItem(replica, a);
    await prisma.canvasDocument.create({
      data: { canvasId, state: toBytes(Y.encodeStateAsUpdate(replica)) },
    });
    const appended: bigint[] = [];
    for (const id of [b, c]) {
      const update = addItem(replica, id);
      appended.push(
        await prisma.$transaction((tx) =>
          appendCanvasDocumentUpdate(tx, { canvasId, update, actorId: null }),
        ),
      );
    }

    let newest = BigInt(0);
    const client = pausingClient(async () => {
      // Between the state read and the update read: compact, then append.
      await prisma.$transaction((tx) =>
        compactCanvasDocument(tx, canvasId, replica, appended[1]),
      );
      const update = addItem(replica, d);
      newest = await prisma.$transaction((tx) =>
        appendCanvasDocumentUpdate(tx, { canvasId, update, actorId: null }),
      );
    });

    const loaded = await readPersistedCanvasDocument(client, canvasId);
    expect(newest).toBeGreaterThan(BigInt(0));
    expect(loaded).not.toBeNull();
    const ids = Array.from(documentItems(loaded!.doc).keys()).sort();
    const cursor = loaded!.updateCursor;
    // Either the pre-compaction snapshot (a, b, c through the second update)
    // or a later one that includes d; never a document missing b and c.
    expect(ids).toEqual(expect.arrayContaining([a, b, c]));
    if (ids.includes(d)) expect(cursor).toBe(newest);
    else expect(cursor).toBe(appended[1]);
  });
});
