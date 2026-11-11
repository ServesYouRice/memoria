// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const html = readFileSync(
  path.resolve(
    import.meta.dirname,
    "../../integrations/browser-extension/popup.html",
  ),
  "utf8",
);

type Tab = {
  id: number;
  url: string;
  title?: string;
  pinned?: boolean;
  pendingUrl?: string;
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

function okBatch(count: number) {
  return {
    ok: true,
    status: 200,
    json: async () => ({
      batchId: "b",
      canvasId: "c",
      itemIds: Array.from({ length: count }, (_, i) => `item-${i}`),
      replayed: false,
      duplicates: [],
    }),
  };
}

async function flush() {
  for (let i = 0; i < 20; i += 1) await Promise.resolve();
  await new Promise((r) => setTimeout(r, 0));
}

let liveTabs: Map<number, Tab>;
let removed: number[][];

async function openPopup(initial: Tab[]) {
  liveTabs = new Map(initial.map((tab) => [tab.id, { ...tab }]));
  removed = [];
  const store: Record<string, unknown> = {
    serverUrl: "https://memoria.example.com",
    apiKey: "mk_abcdefghijklmnopqrstuvwxyz",
  };
  (globalThis as unknown as { chrome: unknown }).chrome = {
    storage: {
      local: {
        get: async (keys: string | string[]) => {
          const list = Array.isArray(keys) ? keys : [keys];
          return Object.fromEntries(
            list.filter((k) => k in store).map((k) => [k, store[k]]),
          );
        },
        set: async (values: Record<string, unknown>) => {
          Object.assign(store, values);
        },
      },
    },
    tabs: {
      query: async () => initial.map((tab) => ({ ...tab })),
      get: async (id: number) => {
        const tab = liveTabs.get(id);
        if (!tab) throw new Error(`No tab with id: ${id}`);
        return { ...tab };
      },
      remove: async (ids: number[]) => {
        removed.push([...ids]);
        for (const id of ids) liveTabs.delete(id);
      },
      create: async () => ({ id: 999 }),
    },
    permissions: { request: async () => true },
  };
  document.documentElement.innerHTML = html.replace(
    /<script[\s\S]*?<\/script>/,
    "",
  );
  vi.resetModules();
  await import("../../integrations/browser-extension/popup.js");
  await flush();
}

const saveButton = () => document.getElementById("save") as HTMLButtonElement;
const checkbox = (id: number) =>
  document.querySelector<HTMLInputElement>(`input[data-tab-id="${id}"]`)!;

describe("browser extension popup save", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    delete (globalThis as unknown as { chrome?: unknown }).chrome;
  });

  it("does not start a second save while one is in flight", async () => {
    await openPopup([
      { id: 1, url: "https://a.example/" },
      { id: 2, url: "https://b.example/" },
      { id: 3, url: "https://c.example/" },
    ]);
    const response = deferred<ReturnType<typeof okBatch>>();
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockImplementation(() => response.promise as never);

    saveButton().click();
    await flush();
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // Changing the selection must not re-enable Save during the request.
    const box = checkbox(3);
    if (!box.disabled) {
      box.checked = false;
      box.dispatchEvent(new Event("change"));
      box.checked = true;
      box.dispatchEvent(new Event("change"));
    }
    expect(saveButton().disabled).toBe(true);

    // A re-entered save (even a programmatic click) is ignored.
    saveButton().disabled = false;
    saveButton().click();
    await flush();
    expect(fetchMock).toHaveBeenCalledTimes(1);

    response.resolve(okBatch(3));
    await flush();
    expect(removed.flat().sort()).toEqual([1, 2, 3]);
  });

  it("leaves open tabs that changed page while the save was in flight", async () => {
    await openPopup([
      { id: 1, url: "https://a.example/" },
      { id: 2, url: "https://b.example/" },
      { id: 3, url: "https://c.example/" },
    ]);
    const response = deferred<ReturnType<typeof okBatch>>();
    vi.mocked(fetch).mockImplementation(() => response.promise as never);

    saveButton().click();
    await flush();
    // Tab 2 navigates, tab 3 starts navigating, during the request.
    liveTabs.set(2, { id: 2, url: "https://elsewhere.example/" });
    liveTabs.set(3, {
      id: 3,
      url: "https://c.example/",
      pendingUrl: "https://next.example/",
    });
    response.resolve(okBatch(3));
    await flush();

    expect(removed.flat()).toEqual([1]);
    expect(document.getElementById("save-status")!.textContent).toMatch(
      /2 tabs changed page and were left open/,
    );
  });

  it("keeps open a hash-routed tab matched to a saved page with another fragment", async () => {
    await openPopup([
      { id: 1, url: "https://plain.example/" },
      { id: 2, url: "https://app.example/#/document/B" },
    ]);
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        batchId: "b",
        canvasId: "c",
        itemIds: ["item-0"],
        replayed: false,
        duplicates: [
          {
            index: 1,
            url: "https://app.example/#/document/B",
            savedItemId: null,
            existing: [
              {
                itemId: "i",
                canvasId: "c",
                canvasName: "Inbox",
                title: "Doc A",
                url: "https://app.example/#/document/A",
                path: "/canvas/c?item=i",
              },
            ],
          },
        ],
      }),
    } as never);

    saveButton().click();
    await flush();

    expect(removed.flat()).toEqual([1]);
    expect(document.getElementById("save-status")!.textContent).toMatch(
      /Saved 1 tab/,
    );
    expect(document.getElementById("save-status")!.textContent).toMatch(
      /left open/,
    );
  });
});
