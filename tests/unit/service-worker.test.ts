import { describe, expect, it } from "vitest";
import fs from "fs";
import path from "path";
import vm from "vm";

/**
 * Loads `public/sw.js` into a sandbox that stands in for the service worker
 * global scope, and returns the registered listeners alongside the fake Cache
 * Storage they act on.
 *
 * The worker is executed rather than pattern-matched: asserting on the source
 * text, or re-declaring the filter inside the test, would keep passing if the
 * predicate in `sw.js` regressed.
 */
function loadServiceWorker(existingCacheNames: string[]) {
  const source = fs.readFileSync(
    path.resolve(import.meta.dirname, "../../public/sw.js"),
    "utf-8",
  );

  const listeners = new Map<string, (event: unknown) => void>();
  const deleted: string[] = [];
  let claimed = false;

  const caches = {
    keys: () => Promise.resolve([...existingCacheNames]),
    delete: (name: string) => {
      deleted.push(name);
      return Promise.resolve(true);
    },
    open: () => Promise.resolve({ addAll: () => Promise.resolve() }),
    match: () => Promise.resolve(undefined),
  };

  const self = {
    location: { origin: "https://memoria.example" },
    addEventListener: (type: string, listener: (event: unknown) => void) => {
      listeners.set(type, listener);
    },
    skipWaiting: () => {},
    clients: {
      claim: () => {
        claimed = true;
        return Promise.resolve();
      },
    },
  };

  const sandbox: Record<string, unknown> = {
    self,
    caches,
    URL,
    fetch,
    console,
  };
  sandbox.globalThis = sandbox;
  vm.runInContext(source, vm.createContext(sandbox));

  return { listeners, deleted, wasClaimed: () => claimed };
}

/**
 * Dispatches an event to a registered listener and awaits whatever it passes
 * to `waitUntil`, the way the browser holds the worker alive.
 */
async function dispatch(
  listeners: Map<string, (event: unknown) => void>,
  type: string,
) {
  const listener = listeners.get(type);
  if (!listener) throw new Error(`sw.js registered no '${type}' listener`);

  let pending: Promise<unknown> = Promise.resolve();
  listener({
    waitUntil: (promise: Promise<unknown>) => {
      pending = promise;
    },
  });
  await pending;
}

describe("service worker cache activation filter", () => {
  it("deletes obsolete Memoria caches and the unsafe legacy cache", async () => {
    const { listeners, deleted } = loadServiceWorker([
      "memoria-public-v2",
      "memoria-public-v1",
      "memoria-assets-v1",
      "canvascollect-v1",
    ]);

    await dispatch(listeners, "activate");

    expect(deleted.sort()).toEqual([
      "canvascollect-v1",
      "memoria-assets-v1",
      "memoria-public-v1",
    ]);
  });

  it("preserves the active cache and caches belonging to other origins", async () => {
    const { listeners, deleted } = loadServiceWorker([
      "memoria-public-v2",
      "cohosted-app-cache",
      "unrelated-service-v1",
      "workbox-precache",
    ]);

    await dispatch(listeners, "activate");

    // A co-hosted application's caches are not ours to evict.
    expect(deleted).toEqual([]);
  });

  it("claims open clients once the sweep completes", async () => {
    const { listeners, wasClaimed } = loadServiceWorker(["memoria-public-v1"]);

    await dispatch(listeners, "activate");

    expect(wasClaimed()).toBe(true);
  });
});
