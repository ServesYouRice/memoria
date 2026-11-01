/**
 * IMP-045: the IndexedDB device copy of collaborative canvas documents —
 * per-user keys, compaction, clearing, ownership and pruning.
 */
import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  CANVAS_SHELL_CACHE,
  claimOfflineCache,
  clearOfflineCache,
  openCanvasDocumentCache,
  pruneOfflineCache,
  readOfflineCacheOwner,
  rememberCanvasShell,
} from "@/lib/collaboration/sync/offline-store";

const meta = { writable: true, unsavedChanges: 0, canvasName: "Plans" };
const bytes = (...values: number[]) => new Uint8Array(values);

const deletedCaches: string[] = [];
const putShells: Array<[string, Response]> = [];

beforeEach(async () => {
  deletedCaches.length = 0;
  putShells.length = 0;
  vi.stubGlobal("caches", {
    delete: async (name: string) => {
      deletedCaches.push(name);
      return true;
    },
    open: async () => ({
      put: async (key: string, response: Response) => {
        putShells.push([key, response]);
      },
    }),
  });
  await clearOfflineCache();
  deletedCaches.length = 0;
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("canvas document cache", () => {
  it("has nothing for a canvas never stored", async () => {
    const cache = openCanvasDocumentCache("user-a", "canvas-1")!;
    expect(await cache.load()).toBeNull();
  });

  it("keeps appended updates and the latest record, in order", async () => {
    const cache = openCanvasDocumentCache("user-a", "canvas-1")!;
    await cache.append(bytes(1), meta);
    await cache.append(bytes(2), { ...meta, unsavedChanges: 2 });

    const stored = await openCanvasDocumentCache("user-a", "canvas-1")!.load();
    expect(stored).toMatchObject({
      writable: true,
      unsavedChanges: 2,
      canvasName: "Plans",
      updates: [bytes(1), bytes(2)],
    });
  });

  it("keeps each user's copy apart", async () => {
    await openCanvasDocumentCache("user-a", "canvas-1")!.append(bytes(1), meta);
    expect(
      await openCanvasDocumentCache("user-b", "canvas-1")!.load(),
    ).toBeNull();
  });

  it("folds what it wrote into one state, keeping updates other tabs added", async () => {
    const tab = openCanvasDocumentCache("user-a", "canvas-1")!;
    const otherTab = openCanvasDocumentCache("user-a", "canvas-1")!;
    await tab.append(bytes(1), meta);
    await otherTab.append(bytes(9), meta);
    await tab.append(bytes(2), meta);
    await tab.compact(bytes(1, 2), { ...meta, unsavedChanges: 1 });

    const stored = await openCanvasDocumentCache("user-a", "canvas-1")!.load();
    expect(stored?.updates).toEqual([bytes(1, 2), bytes(9)]);
    expect(stored?.unsavedChanges).toBe(1);
  });

  it("clears every update of the copy, also those of other tabs", async () => {
    const tab = openCanvasDocumentCache("user-a", "canvas-1")!;
    const otherTab = openCanvasDocumentCache("user-a", "canvas-1")!;
    await tab.append(bytes(1), meta);
    await otherTab.append(bytes(2), meta);
    await openCanvasDocumentCache("user-a", "canvas-2")!.append(bytes(3), meta);

    await tab.clear();

    expect(
      await openCanvasDocumentCache("user-a", "canvas-1")!.load(),
    ).toBeNull();
    expect(
      (await openCanvasDocumentCache("user-a", "canvas-2")!.load())?.updates,
    ).toEqual([bytes(3)]);

    // Writes after the clear start a new copy.
    await tab.append(bytes(4), meta);
    expect(
      (await openCanvasDocumentCache("user-a", "canvas-1")!.load())?.updates,
    ).toEqual([bytes(4)]);
  });
});

describe("offline cache ownership", () => {
  it("wipes another user's copies and shells when a new user claims the cache", async () => {
    await claimOfflineCache("user-a");
    await openCanvasDocumentCache("user-a", "canvas-1")!.append(bytes(1), meta);
    expect(await readOfflineCacheOwner()).toBe("user-a");

    await claimOfflineCache("user-a");
    expect(deletedCaches).toEqual([]);
    expect(
      await openCanvasDocumentCache("user-a", "canvas-1")!.load(),
    ).not.toBeNull();

    await claimOfflineCache("user-b");
    expect(await readOfflineCacheOwner()).toBe("user-b");
    expect(
      await openCanvasDocumentCache("user-a", "canvas-1")!.load(),
    ).toBeNull();
    expect(deletedCaches).toEqual([CANVAS_SHELL_CACHE]);
  });

  it("clears every copy, the owner and the shells on sign-out", async () => {
    await claimOfflineCache("user-a");
    await openCanvasDocumentCache("user-a", "canvas-1")!.append(bytes(1), {
      ...meta,
      unsavedChanges: 3,
    });

    await clearOfflineCache();

    expect(await readOfflineCacheOwner()).toBeNull();
    expect(
      await openCanvasDocumentCache("user-a", "canvas-1")!.load(),
    ).toBeNull();
    expect(deletedCaches).toEqual([CANVAS_SHELL_CACHE]);
  });

  it("prunes the oldest synced copies, never unsaved ones or the open canvas", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      for (const [index, unsaved] of [
        ["0", 0],
        ["1", 4],
        ["2", 0],
        ["3", 0],
        ["4", 0],
      ] as const) {
        vi.setSystemTime(1_000 + Number(index));
        await openCanvasDocumentCache("user-a", `canvas-${index}`)!.append(
          bytes(Number(index)),
          { ...meta, unsavedChanges: unsaved },
        );
      }
    } finally {
      vi.useRealTimers();
    }

    await pruneOfflineCache({ keep: "canvas-0", max: 3 });

    const remaining = [];
    for (const index of ["0", "1", "2", "3", "4"]) {
      if (await openCanvasDocumentCache("user-a", `canvas-${index}`)!.load())
        remaining.push(index);
    }
    expect(remaining).toEqual(["0", "1", "4"]);
  });
});

describe("canvas page shells", () => {
  it("stores the page only online, under a service worker", async () => {
    const fetchMock = vi.fn(
      async () => new Response("<html></html>", { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchMock);
    // Node's Response reports type "default"; a browser's same-origin
    // response is "basic".
    const basic = new Response("<html></html>", { status: 200 });
    Object.defineProperty(basic, "type", { value: "basic" });
    fetchMock.mockResolvedValueOnce(basic);

    vi.stubGlobal("navigator", {
      onLine: true,
      serviceWorker: { controller: {} },
    });
    await rememberCanvasShell("/canvas/cabc");
    expect(putShells.map(([key]) => key)).toEqual(["/canvas/cabc"]);
    expect(fetchMock).toHaveBeenCalledWith("/canvas/cabc", {
      credentials: "same-origin",
      redirect: "manual",
    });

    vi.stubGlobal("navigator", {
      onLine: false,
      serviceWorker: { controller: {} },
    });
    await rememberCanvasShell("/canvas/cabc");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
