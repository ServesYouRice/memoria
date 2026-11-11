/**
 * Two tabs of one user share the device copy of a canvas. Each tab's
 * compaction must keep the compacted edits of the other.
 */
import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it } from "vitest";
import * as Y from "yjs";
import {
  clearOfflineCache,
  openCanvasDocumentCache,
} from "@/lib/collaboration/sync/offline-store";

const meta = { writable: true, unsavedChanges: 1, canvasName: "Plans" };

beforeEach(async () => {
  await clearOfflineCache();
});

function tabEdit(doc: Y.Doc, key: string, value: string) {
  let update: Uint8Array | null = null;
  const capture = (next: Uint8Array) => {
    update = next;
  };
  doc.on("update", capture);
  doc.getMap("items").set(key, value);
  doc.off("update", capture);
  return update!;
}

describe("offline-store compaction across tabs", () => {
  it("keeps tab A's compacted edits when tab B compacts later", async () => {
    const cacheA = openCanvasDocumentCache("user-a", "canvas-1")!;
    const cacheB = openCanvasDocumentCache("user-a", "canvas-1")!;
    const docA = new Y.Doc();
    const docB = new Y.Doc();

    await cacheA.append(tabEdit(docA, "a", "from tab A"), meta);
    await cacheB.append(tabEdit(docB, "b", "from tab B"), meta);
    await cacheA.compact(Y.encodeStateAsUpdate(docA), meta);
    await cacheB.compact(Y.encodeStateAsUpdate(docB), meta);

    const stored = await openCanvasDocumentCache("user-a", "canvas-1")!.load();
    const restored = new Y.Doc();
    for (const update of stored!.updates) Y.applyUpdate(restored, update);
    expect(restored.getMap("items").toJSON()).toEqual({
      a: "from tab A",
      b: "from tab B",
    });
  });
});
