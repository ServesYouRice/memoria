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
let store: Record<string, unknown>;
let created: { url?: string }[];
let selectionText: string | Error;
let badge: string[];

async function openPopup(
  initial: Tab[],
  {
    view = "tabs",
    stored = {},
  }: { view?: "page" | "tabs"; stored?: Record<string, unknown> } = {},
) {
  liveTabs = new Map(initial.map((tab) => [tab.id, { ...tab }]));
  removed = [];
  created = [];
  badge = [];
  selectionText = "";
  store = {
    serverUrl: "https://memoria.example.com",
    apiKey: "mk_abcdefghijklmnopqrstuvwxyz",
    ...stored,
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
      create: async (props: { url?: string }) => {
        created.push(props);
        return { id: 999 };
      },
    },
    scripting: {
      executeScript: async () => {
        if (selectionText instanceof Error) throw selectionText;
        return [{ result: selectionText }];
      },
    },
    action: {
      setBadgeText: async ({ text }: { text: string }) => {
        badge.push(text);
      },
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
  if (view === "tabs") {
    (document.getElementById("show-tabs") as HTMLButtonElement).click();
    await flush();
  }
  // Opening the popup loads the canvas list; tests count their own requests.
  vi.mocked(fetch).mockClear();
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

function jsonResponse(body: unknown, status = 200) {
  return { ok: status < 400, status, json: async () => body };
}

const CANVASES = {
  canvases: [
    { id: "cinbox00000000000000000a", name: "Inbox" },
    { id: "ctrip000000000000000000b", name: "Trip" },
  ],
};

describe("browser extension popup: save this page (IMP-093)", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    delete (globalThis as unknown as { chrome?: unknown }).chrome;
  });

  const page = { id: 7, url: "https://read.example/post", title: "A post" };
  const select = () => document.getElementById("canvas") as HTMLSelectElement;
  const status = () => document.getElementById("page-status")!;

  it("opens on Save this page with the canvas picker on the Inbox", async () => {
    vi.mocked(fetch).mockResolvedValue(jsonResponse(CANVASES) as never);
    await openPopup([page], { view: "page" });

    expect(document.getElementById("page")!.hidden).toBe(false);
    expect(document.getElementById("main")!.hidden).toBe(true);
    expect(document.getElementById("page-title")!.textContent).toBe("A post");
    expect(select().value).toBe("cinbox00000000000000000a");
    expect([...select().options].map((o) => o.textContent)).toEqual([
      "Inbox",
      "Trip",
    ]);

    // "Save all tabs" stays one click away.
    (document.getElementById("show-tabs") as HTMLButtonElement).click();
    await flush();
    expect(document.getElementById("main")!.hidden).toBe(false);
  });

  it("remembers the last canvas and saves the selected text with the link", async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValue(jsonResponse(CANVASES) as never);
    await openPopup([page], {
      view: "page",
      stored: { lastCanvasId: "ctrip000000000000000000b" },
    });
    expect(select().value).toBe("ctrip000000000000000000b");

    selectionText = "  the key sentence  ";
    fetchMock.mockResolvedValue(
      jsonResponse({
        created: true,
        duplicate: false,
        item: { id: "item1", canvasId: "ctrip000000000000000000b" },
        duplicates: [],
      }) as never,
    );
    (document.getElementById("save-page") as HTMLButtonElement).click();
    await flush();

    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("https://memoria.example.com/api/v1/extensions/clip");
    expect(JSON.parse(String((init as RequestInit).body))).toEqual({
      url: "https://read.example/post",
      title: "A post",
      selection: "the key sentence",
      canvasId: "ctrip000000000000000000b",
    });
    expect(status().textContent).toBe("Saved to Trip.");
    (document.getElementById("open-existing") as HTMLButtonElement).click();
    expect(created.at(-1)?.url).toBe(
      "https://memoria.example.com/canvas/ctrip000000000000000000b?item=item1",
    );

    // Choosing another canvas is remembered for next time.
    select().value = "cinbox00000000000000000a";
    select().dispatchEvent(new Event("change"));
    await flush();
    expect(store.lastCanvasId).toBe("cinbox00000000000000000a");
    expect(store.lastCanvasName).toBe("Inbox");
  });

  it("reports a link that is already saved with a way to open it", async () => {
    vi.mocked(fetch).mockResolvedValue(jsonResponse(CANVASES) as never);
    await openPopup([page], { view: "page" });
    selectionText = new Error("Cannot access this page");
    vi.mocked(fetch).mockResolvedValue(
      jsonResponse({
        created: false,
        duplicate: true,
        duplicates: [
          {
            itemId: "old",
            canvasId: "ctrip000000000000000000b",
            canvasName: "Trip",
            title: "A post",
            url: "https://read.example/post",
            path: "/canvas/ctrip000000000000000000b?item=old",
          },
        ],
      }) as never,
    );
    (document.getElementById("save-page") as HTMLButtonElement).click();
    await flush();

    expect(status().textContent).toBe("You saved this already, in Trip.");
    const open = document.getElementById("open-existing") as HTMLButtonElement;
    expect(open.hidden).toBe(false);
    open.click();
    expect(created.at(-1)?.url).toBe(
      "https://memoria.example.com/canvas/ctrip000000000000000000b?item=old",
    );
  });

  it("still saves to the Inbox when the canvas list cannot load", async () => {
    vi.mocked(fetch).mockRejectedValue(new Error("offline"));
    await openPopup([page], { view: "page" });
    expect(select().value).toBe("");
    expect(select().options[0]!.textContent).toBe("Inbox");
  });

  it("does not offer to save a browser page", async () => {
    await openPopup([{ id: 1, url: "chrome://settings", title: "Settings" }], {
      view: "page",
    });
    expect(
      (document.getElementById("save-page") as HTMLButtonElement).disabled,
    ).toBe(true);
    expect(document.getElementById("page-error")!.textContent).toMatch(
      /browser page/,
    );
  });

  it("shows a save the shortcut made while the popup was closed, once", async () => {
    await openPopup([page], {
      view: "page",
      stored: {
        lastResult: {
          saved: false,
          title: "A post",
          message: "You saved this already, in Trip.",
          openUrl: "https://memoria.example.com/canvas/c?item=old",
          at: Date.now(),
        },
      },
    });
    expect(status().textContent).toBe(
      "A post: You saved this already, in Trip.",
    );
    expect(document.getElementById("open-existing")!.hidden).toBe(false);
    expect(store.lastResult).toBeNull();
    expect(badge).toEqual([""]);
  });
});
