import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  buildBatchBody,
  buildClipBody,
  fetchCanvases,
  initialCanvasId,
  MAX_SELECTION_LENGTH,
  pageFromMenuClick,
  sendClip,
  chunk,
  closableTabIds,
  isApiKey,
  isPreselected,
  normalizeServerUrl,
  originPattern,
  selectionSignature,
  sendBatch,
} from "../../integrations/browser-extension/lib.js";
import { clipBatchSchema, clipSchema } from "@/lib/validation/extension";
import { manifestFor, zip } from "../../scripts/build-browser-extension.mjs";

describe("browser extension helpers", () => {
  it("preselects normal web tabs only", () => {
    expect(isPreselected({ url: "https://example.com", pinned: false })).toBe(
      true,
    );
    expect(isPreselected({ url: "http://localhost:3000", pinned: false })).toBe(
      true,
    );
    expect(isPreselected({ url: "https://example.com", pinned: true })).toBe(
      false,
    );
    for (const url of [
      "chrome://extensions",
      "edge://settings",
      "about:addons",
      "chrome-extension://abc/popup.html",
      "moz-extension://abc/popup.html",
      "file:///tmp/a.html",
      undefined,
    ]) {
      expect(isPreselected({ url, pinned: false })).toBe(false);
    }
  });

  it("normalizes the pasted Memoria address to an origin", () => {
    expect(normalizeServerUrl(" memoria.example.com/app ")).toBe(
      "https://memoria.example.com",
    );
    expect(normalizeServerUrl("http://localhost:3000/")).toBe(
      "http://localhost:3000",
    );
    expect(originPattern("https://memoria.example.com/x")).toBe(
      "https://memoria.example.com/*",
    );
    expect(() => normalizeServerUrl("")).toThrow();
    expect(() => normalizeServerUrl("ftp://memoria.example.com")).toThrow();
  });

  it("refuses plain-HTTP Memoria addresses except loopback", () => {
    expect(() => normalizeServerUrl("http://memoria.example.com")).toThrow(
      "must start with https://",
    );
    expect(() => normalizeServerUrl("http://192.168.1.5")).toThrow(
      "must start with https://",
    );
    expect(() => originPattern("http://memoria.example.com")).toThrow();
    expect(normalizeServerUrl("https://memoria.example.com")).toBe(
      "https://memoria.example.com",
    );
    expect(normalizeServerUrl("http://localhost:3000")).toBe(
      "http://localhost:3000",
    );
    expect(normalizeServerUrl("http://app.localhost:3000")).toBe(
      "http://app.localhost:3000",
    );
    expect(normalizeServerUrl("http://127.0.0.1:3000")).toBe(
      "http://127.0.0.1:3000",
    );
    expect(normalizeServerUrl("http://127.5.6.7")).toBe("http://127.5.6.7");
    expect(normalizeServerUrl("http://[::1]:3000")).toBe("http://[::1]:3000");
    expect(() => normalizeServerUrl("http://127.0.0.1.example.com")).toThrow();
    expect(() => normalizeServerUrl("http://localhost.example.com")).toThrow();
  });

  it("never sends the API key to a remote plain-HTTP address", async () => {
    const fetchImpl = vi.fn();
    await expect(
      sendBatch({
        serverUrl: "http://memoria.example.com",
        apiKey: "mk_abcdefghijklmnopqrstuvwxyz",
        tabs: [{ url: "https://example.com", title: "Example" }],
        note: "",
        idempotencyKey: "00000000-0000-4000-8000-000000000000",
        fetchImpl,
      }),
    ).rejects.toThrow("must start with https://");
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("closes only tabs that still show the submitted page", () => {
    const submitted = [
      { id: 1, url: "https://a.example/" },
      { id: 2, url: "https://b.example/" },
      { id: 3, url: "https://c.example/" },
      { id: 4, url: "https://d.example/" },
    ];
    const current = new Map<
      number,
      { url: string; pendingUrl?: string } | null
    >([
      [1, { url: "https://a.example/" }],
      [2, { url: "https://elsewhere.example/" }],
      [3, { url: "https://c.example/", pendingUrl: "https://next.example/" }],
      [4, null],
    ]);
    expect(closableTabIds(submitted, current)).toEqual({
      closable: [1],
      changed: [2, 3, 4],
    });
  });

  it("recognizes Memoria API keys", () => {
    expect(isApiKey("mk_abcdefghijklmnopqrstuvwxyz")).toBe(true);
    expect(isApiKey("sk_abcdefghijklmnopqrstuvwxyz")).toBe(false);
    expect(isApiKey("mk_short")).toBe(false);
  });

  it("builds a body the batch endpoint accepts and splits at 100 links", () => {
    const tabs = Array.from({ length: 101 }, (_, index) => ({
      url: `https://example.com/${index}`,
      title: index === 0 ? "" : `Tab ${index}`,
    }));
    const groups = chunk(tabs);
    expect(groups.map((group) => group.length)).toEqual([100, 1]);

    const body = buildBatchBody(groups[0], "  by topic ", crypto.randomUUID());
    expect(body.note).toBe("by topic");
    expect(body.links[0]).toEqual({ url: "https://example.com/0" });
    expect(clipBatchSchema.safeParse(body).success).toBe(true);
    expect(buildBatchBody(groups[1], "   ", "key-12345678")).not.toHaveProperty(
      "note",
    );
  });

  it("gives the same selection the same signature", () => {
    const tabs = [{ url: "https://a.example", title: "A" }];
    expect(selectionSignature(tabs, "x ")).toBe(selectionSignature(tabs, "x"));
    expect(selectionSignature(tabs, "x")).not.toBe(
      selectionSignature(tabs, "y"),
    );
  });

  it("resolves only when the server confirms every tab", async () => {
    const tabs = [
      { url: "https://a.example", title: "A" },
      { url: "https://b.example", title: "B" },
    ];
    const ok = vi.fn(async () =>
      Response.json(
        { batchId: "b1", canvasId: "c1", itemIds: ["i1", "i2"] },
        { status: 201 },
      ),
    );
    await expect(
      sendBatch({
        serverUrl: "memoria.example.com",
        apiKey: " mk_abcdefghijklmnopqrstuvwxyz ",
        tabs,
        note: "",
        idempotencyKey: "key-12345678",
        fetchImpl: ok,
      }),
    ).resolves.toMatchObject({ itemIds: ["i1", "i2"] });
    const [url, init] = ok.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(
      "https://memoria.example.com/api/v1/extensions/clip/batch",
    );
    expect((init.headers as Record<string, string>)["x-api-key"]).toBe(
      "mk_abcdefghijklmnopqrstuvwxyz",
    );

    const partial = vi.fn(async () =>
      Response.json({ itemIds: ["i1"] }, { status: 201 }),
    );
    await expect(
      sendBatch({
        serverUrl: "https://m.example",
        apiKey: "mk_x",
        tabs,
        idempotencyKey: "key-12345678",
        fetchImpl: partial,
      }),
    ).rejects.toThrow(/did not confirm/);

    const rejected = vi.fn(async () =>
      Response.json(
        { title: "Quota Exceeded", detail: "canvas items limit of 2000" },
        { status: 422 },
      ),
    );
    await expect(
      sendBatch({
        serverUrl: "https://m.example",
        apiKey: "mk_x",
        tabs,
        idempotencyKey: "key-12345678",
        fetchImpl: rejected,
      }),
    ).rejects.toThrow(/canvas items limit/);

    const offline = vi.fn(async () => {
      throw new TypeError("Failed to fetch");
    });
    await expect(
      sendBatch({
        serverUrl: "https://m.example",
        apiKey: "mk_x",
        tabs,
        idempotencyKey: "key-12345678",
        fetchImpl: offline,
      }),
    ).rejects.toThrow(/Could not reach Memoria/);
  });
});

describe("browser extension over-long tab URLs", () => {
  const urlOfLength = (length: number) => {
    const base = "https://example.com/";
    return base + "a".repeat(length - base.length);
  };

  it("does not preselect or allow a tab whose URL exceeds the server limit", async () => {
    const lib =
      (await import("../../integrations/browser-extension/lib.js")) as Record<
        string,
        unknown
      >;
    const isSavableUrl = lib.isSavableUrl as (url: string) => boolean;
    expect(typeof isSavableUrl).toBe("function");
    expect(isPreselected({ url: urlOfLength(2048), pinned: false })).toBe(true);
    expect(isPreselected({ url: urlOfLength(2049), pinned: false })).toBe(
      false,
    );
    expect(isSavableUrl(urlOfLength(2048))).toBe(true);
    expect(isSavableUrl(urlOfLength(2049))).toBe(false);
    expect(isSavableUrl("chrome://settings")).toBe(false);
  });

  it("keeps the client limit equal to the server's MAX_URL_LENGTH", async () => {
    const lib =
      (await import("../../integrations/browser-extension/lib.js")) as Record<
        string,
        unknown
      >;
    const { MAX_URL_LENGTH } = await import("@/lib/constants");
    expect(lib.MAX_URL_LENGTH).toBe(MAX_URL_LENGTH);
  });

  it("names the tab the server rejected", async () => {
    const rejected = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            title: "Validation Error",
            status: 400,
            errors: [
              {
                field: "links.1.url",
                message: "String must contain at most 2048 character(s)",
              },
            ],
          }),
          {
            status: 400,
            headers: { "content-type": "application/problem+json" },
          },
        ),
    );
    await expect(
      sendBatch({
        serverUrl: "https://memoria.example.com",
        apiKey: "mk_abcdefghijklmnopqrstuvwxyz",
        tabs: [
          { id: 1, url: "https://example.com/one", title: "One" },
          { id: 2, url: "https://example.com/two", title: "The long one" },
        ],
        note: "",
        idempotencyKey: "key-1",
        fetchImpl: rejected,
      }),
    ).rejects.toThrow(/The long one/);
  });
});

describe("browser extension duplicate confirmation", () => {
  const duplicate = (index: number, url: string, existingUrls: unknown[]) => ({
    index,
    url,
    savedItemId: null,
    existing: existingUrls.map((existingUrl) => ({
      itemId: "i",
      canvasId: "c",
      path: "/canvas/c?item=i",
      ...(existingUrl === undefined ? {} : { url: existingUrl }),
    })),
  });

  it("does not confirm a duplicate whose saved copy has another fragment", async () => {
    const lib =
      (await import("../../integrations/browser-extension/lib.js")) as Record<
        string,
        unknown
      >;
    const unconfirmed = lib.unconfirmedDuplicateTabIds as (
      tabs: unknown[],
      body: unknown,
    ) => number[];
    expect(typeof unconfirmed).toBe("function");
    const tabs = [
      { id: 1, url: "https://app.example/#/document/B" },
      { id: 2, url: "https://same.example/page#top" },
      { id: 3, url: "https://unknown.example/#/x" },
      { id: 4, url: "https://unknown.example/plain" },
      { id: 5, url: "https://new.example/" },
    ];
    const body = {
      itemIds: ["item-5"],
      duplicates: [
        duplicate(0, tabs[0]!.url, ["https://app.example/#/document/A"]),
        duplicate(1, tabs[1]!.url, ["https://same.example/page#top"]),
        duplicate(2, tabs[2]!.url, [undefined]),
        duplicate(3, tabs[3]!.url, [undefined]),
      ],
    };
    expect(unconfirmed(tabs, body)).toEqual([1, 3]);
  });
});

describe("single-page save helpers (IMP-093)", () => {
  it("builds a clip body the server accepts, trimming and capping the selection", () => {
    const body = buildClipBody({
      url: "https://a.example/",
      title: " Title ",
      selection: ` ${"x".repeat(3000)} `,
      canvasId: "ctrip000000000000000000b",
    });
    expect(body.title).toBe("Title");
    expect(body.selection).toHaveLength(MAX_SELECTION_LENGTH);
    expect(clipSchema.safeParse(body).success).toBe(true);
    expect(
      buildClipBody({ url: "https://a.example/", selection: "  " }),
    ).toEqual({ url: "https://a.example/" });
  });

  it("starts the picker on the remembered canvas, else the Inbox", () => {
    const canvases = [
      { id: "a", name: "Trip" },
      { id: "b", name: "Inbox" },
    ];
    expect(initialCanvasId(canvases, "a")).toBe("a");
    expect(initialCanvasId(canvases, "gone")).toBe("b");
    expect(initialCanvasId([{ id: "a", name: "Trip" }], undefined)).toBe("");
  });

  it("names the link under the pointer, or the page with its selection", () => {
    expect(
      pageFromMenuClick(
        { linkUrl: "https://l.example/", linkText: "Link" },
        { url: "https://p.example/", title: "P" },
      ),
    ).toEqual({ url: "https://l.example/", title: "Link" });
    expect(
      pageFromMenuClick(
        { pageUrl: "https://p.example/", selectionText: "words" },
        { url: "https://p.example/", title: "P" },
      ),
    ).toEqual({ url: "https://p.example/", title: "P", selection: "words" });
  });

  it("refuses to send a browser page and reports a key the server refused", async () => {
    const fetchImpl = vi.fn();
    await expect(
      sendClip({
        serverUrl: "https://m.example",
        apiKey: "mk_x",
        page: { url: "about:blank" },
        fetchImpl,
      }),
    ).rejects.toThrow(/web pages/);
    expect(fetchImpl).not.toHaveBeenCalled();
    await expect(
      fetchCanvases({
        serverUrl: "https://m.example",
        apiKey: "mk_x",
        fetchImpl: async () =>
          ({ ok: false, status: 401, json: async () => ({}) }) as never,
      }),
    ).rejects.toThrow(/did not accept the API key/);
  });

  it("asks for the smallest permissions that work", () => {
    const manifest = JSON.parse(
      readFileSync(
        path.resolve(
          import.meta.dirname,
          "../../integrations/browser-extension/manifest.json",
        ),
        "utf8",
      ),
    );
    expect(manifest.permissions.sort()).toEqual(
      ["activeTab", "contextMenus", "scripting", "storage", "tabs"].sort(),
    );
    expect(manifest.host_permissions).toBeUndefined();
    expect(manifest.content_scripts).toBeUndefined();
    expect(manifest.commands["save-page"].suggested_key.default).toBeTruthy();
  });

  it("builds a Chrome and a Firefox manifest with only the keys each reads", () => {
    const manifest = {
      background: {
        service_worker: "background.js",
        scripts: ["background.js"],
        type: "module",
      },
      browser_specific_settings: { gecko: { id: "x" } },
    };
    expect(manifestFor("chrome", manifest)).toEqual({
      background: { service_worker: "background.js", type: "module" },
    });
    expect(manifestFor("firefox", manifest)).toEqual({
      background: { scripts: ["background.js"], type: "module" },
      browser_specific_settings: { gecko: { id: "x" } },
    });
  });

  it("writes a zip with the right checksums", () => {
    const archive = zip([["a.txt", Buffer.from("hello")]]);
    expect(archive.readUInt32LE(0)).toBe(0x04034b50);
    // CRC-32 of "hello".
    expect(archive.readUInt32LE(14)).toBe(0x3610a686);
    expect(archive.readUInt32LE(archive.length - 22)).toBe(0x06054b50);
  });
});
