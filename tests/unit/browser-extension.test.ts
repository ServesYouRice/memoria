import { describe, expect, it, vi } from "vitest";
import {
  buildBatchBody,
  chunk,
  isApiKey,
  isPreselected,
  normalizeServerUrl,
  originPattern,
  selectionSignature,
  sendBatch,
} from "../../integrations/browser-extension/lib.js";
import { clipBatchSchema } from "@/lib/validation/extension";

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
