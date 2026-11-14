/** IMP-152 — the browser's direct upload flow and its fallback. */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  resetDirectUploadClientState,
  uploadFileDirect,
} from "@/lib/uploads/direct-upload-client";

const fetchMock = vi.fn();
const fallback = vi.fn();
const file = new File([new Uint8Array(1024)], "photo.png", {
  type: "image/png",
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status });
}

beforeEach(() => {
  resetDirectUploadClientState();
  fetchMock.mockReset();
  fallback.mockReset().mockResolvedValue(json({ storage: "local" }));
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe("uploadFileDirect", () => {
  it("presigns, PUTs to storage and confirms", async () => {
    fetchMock.mockImplementation(async (url: string) => {
      if (url === "/api/v1/upload/direct") {
        return json(
          {
            assetId: "asset-1",
            uploadUrl: "https://bucket.example.com/incoming/x?sig",
            method: "PUT",
            headers: { "Content-Type": "image/png" },
          },
          201,
        );
      }
      if (url.startsWith("https://bucket.example.com/")) {
        return new Response(null, { status: 200 });
      }
      return json({ assetId: "asset-1", storage: "s3" });
    });
    const response = await uploadFileDirect(file, {
      canvasId: "canvas-1",
      fallback,
      fallbackMaxBytes: 5 * 1024 * 1024,
    });
    expect(await response.json()).toEqual({
      assetId: "asset-1",
      storage: "s3",
    });
    expect(fallback).not.toHaveBeenCalled();
    expect(JSON.parse(fetchMock.mock.calls[0]![1].body)).toEqual({
      canvasId: "canvas-1",
      filename: "photo.png",
      contentType: "image/png",
      size: 1024,
    });
    expect(fetchMock.mock.calls[1]![1]).toMatchObject({
      method: "PUT",
      headers: { "Content-Type": "image/png" },
      body: file,
    });
    expect(fetchMock.mock.calls[2]![0]).toBe("/api/v1/upload/direct/confirm");
    expect(JSON.parse(fetchMock.mock.calls[2]![1].body)).toEqual({
      assetId: "asset-1",
    });
  });

  it("uses the proxied route when the server has no direct path, and remembers it", async () => {
    fetchMock.mockResolvedValue(
      json(
        { type: "https://memoria.local/errors/direct-upload-unavailable" },
        409,
      ),
    );
    const options = {
      canvasId: "canvas-1",
      fallback,
      fallbackMaxBytes: 5 * 1024 * 1024,
    };
    await uploadFileDirect(file, options);
    await uploadFileDirect(file, options);
    expect(fallback).toHaveBeenCalledTimes(2);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("falls back when storage cannot be reached and the file fits", async () => {
    fetchMock.mockImplementation(async (url: string) => {
      if (url === "/api/v1/upload/direct") {
        return json(
          {
            assetId: "asset-1",
            uploadUrl: "https://bucket.example.com/x",
            method: "PUT",
            headers: {},
          },
          201,
        );
      }
      throw new TypeError("Failed to fetch");
    });
    await uploadFileDirect(file, {
      canvasId: "canvas-1",
      fallback,
      fallbackMaxBytes: 5 * 1024 * 1024,
    });
    expect(fallback).toHaveBeenCalledTimes(1);

    fallback.mockClear();
    await expect(
      uploadFileDirect(file, {
        canvasId: "canvas-1",
        fallback,
        fallbackMaxBytes: 10,
      }),
    ).rejects.toThrow("Failed to fetch");
    expect(fallback).not.toHaveBeenCalled();
  });

  it("passes a refusal such as a quota error through", async () => {
    fetchMock.mockResolvedValue(json({ title: "Too large" }, 413));
    const response = await uploadFileDirect(file, {
      canvasId: "canvas-1",
      fallback,
      fallbackMaxBytes: 10,
    });
    expect(response.status).toBe(413);
    expect(fallback).not.toHaveBeenCalled();
  });
});
