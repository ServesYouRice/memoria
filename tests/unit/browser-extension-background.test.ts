import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type Listener = (...args: unknown[]) => unknown;

let store: Record<string, unknown>;
let listeners: Record<string, Listener>;
let menus: unknown[];
let badge: string[];

async function loadBackground(stored: Record<string, unknown> = {}) {
  store = {
    serverUrl: "https://memoria.example.com",
    apiKey: "mk_abcdefghijklmnopqrstuvwxyz",
    ...stored,
  };
  listeners = {};
  menus = [];
  badge = [];
  const on = (name: string) => ({
    addListener: (fn: Listener) => {
      listeners[name] = fn;
    },
  });
  (globalThis as unknown as { chrome: unknown }).chrome = {
    runtime: { onInstalled: on("installed"), onStartup: on("startup") },
    contextMenus: {
      removeAll: async () => {
        menus = [];
      },
      create: (menu: unknown) => menus.push(menu),
      onClicked: on("menu"),
    },
    commands: { onCommand: on("command") },
    tabs: {
      query: async () => [
        { id: 3, url: "https://page.example/a", title: "Page A" },
      ],
    },
    scripting: {
      executeScript: async () => [{ result: "picked words" }],
    },
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
    action: {
      setBadgeText: async ({ text }: { text: string }) => badge.push(text),
      setBadgeBackgroundColor: async () => {},
      setTitle: async () => {},
    },
  };
  vi.resetModules();
  await import("../../integrations/browser-extension/background.js");
}

const sent = () =>
  vi
    .mocked(fetch)
    .mock.calls.map(([url, init]) => [
      url,
      JSON.parse(String((init as RequestInit).body)),
    ]);

function saved() {
  return {
    ok: true,
    status: 200,
    json: async () => ({
      created: true,
      item: { id: "i1", canvasId: "ctrip000000000000000000b" },
      duplicates: [],
    }),
  };
}

describe("browser extension background (IMP-093)", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    delete (globalThis as unknown as { chrome?: unknown }).chrome;
  });

  it("offers Save to Memoria on pages, links and selections", async () => {
    await loadBackground();
    await listeners.installed!();
    expect(menus).toEqual([
      {
        id: "save-to-memoria",
        title: "Save to Memoria",
        contexts: ["page", "link", "selection"],
      },
    ]);
  });

  it("saves a right-clicked selection to the last chosen canvas", async () => {
    await loadBackground({
      lastCanvasId: "ctrip000000000000000000b",
      lastCanvasName: "Trip",
    });
    vi.mocked(fetch).mockResolvedValue(saved() as never);
    await listeners.menu!(
      {
        menuItemId: "save-to-memoria",
        pageUrl: "https://page.example/a",
        selectionText: "a quote",
      },
      { id: 3, url: "https://page.example/a", title: "Page A" },
    );
    await vi.waitFor(() => expect(badge).toEqual(["✓"]));
    expect(sent()).toEqual([
      [
        "https://memoria.example.com/api/v1/extensions/clip",
        {
          url: "https://page.example/a",
          title: "Page A",
          selection: "a quote",
          canvasId: "ctrip000000000000000000b",
        },
      ],
    ]);
    expect(store.lastResult).toMatchObject({
      saved: true,
      message: "Saved to Trip.",
      openUrl:
        "https://memoria.example.com/canvas/ctrip000000000000000000b?item=i1",
    });
  });

  it("saves the link under the pointer, not the page", async () => {
    await loadBackground();
    vi.mocked(fetch).mockResolvedValue(saved() as never);
    await listeners.menu!(
      {
        menuItemId: "save-to-memoria",
        pageUrl: "https://page.example/a",
        linkUrl: "https://other.example/b",
      },
      { id: 3, url: "https://page.example/a", title: "Page A" },
    );
    await vi.waitFor(() => expect(badge).toHaveLength(1));
    expect(sent()[0]![1]).toEqual({
      url: "https://other.example/b",
      title: "https://other.example/b",
    });
  });

  it("saves the current page with its selection from the keyboard shortcut", async () => {
    await loadBackground();
    vi.mocked(fetch).mockResolvedValue(saved() as never);
    await listeners.command!("save-page", {
      id: 3,
      url: "https://page.example/a",
      title: "Page A",
    });
    expect(sent()[0]![1]).toEqual({
      url: "https://page.example/a",
      title: "Page A",
      selection: "picked words",
    });
    expect(store.lastResult).toMatchObject({ message: "Saved to Inbox." });
  });

  it("marks a link that was already saved and keeps the way to open it", async () => {
    await loadBackground();
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        created: false,
        duplicate: true,
        duplicates: [
          {
            canvasName: "Inbox",
            title: "Page A",
            path: "/canvas/c1?item=old",
          },
        ],
      }),
    } as never);
    await listeners.command!("save-page", undefined);
    expect(badge).toEqual(["="]);
    expect(store.lastResult).toMatchObject({
      saved: false,
      message: "You saved this already, in Inbox.",
      openUrl: "https://memoria.example.com/canvas/c1?item=old",
    });
  });

  it("asks to connect first, and never sends a browser page", async () => {
    await loadBackground({ apiKey: undefined });
    await listeners.command!("save-page", {
      id: 1,
      url: "https://page.example/a",
    });
    expect(store.lastResult).toMatchObject({ error: /connect first/ });

    await loadBackground();
    await listeners.command!("save-page", { id: 1, url: "chrome://newtab" });
    expect(fetch).not.toHaveBeenCalled();
    expect(badge).toEqual(["!"]);
  });
});
