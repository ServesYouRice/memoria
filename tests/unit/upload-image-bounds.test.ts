import { describe, expect, it } from "vitest";

import {
  MAX_IMAGE_EDGE,
  MAX_IMAGE_FRAMES,
  checkImageBounds,
} from "@/lib/uploads/image-bounds";
import {
  gifBytes,
  jpegBytes,
  pngBytes,
  webpLosslessBytes,
  webpAnimatedBytes,
} from "../helpers/image-fixtures";

describe("checkImageBounds", () => {
  it("accepts ordinary images and reports their dimensions", () => {
    expect(checkImageBounds(pngBytes(640, 480), "image/png")).toEqual({
      ok: true,
      info: { width: 640, height: 480, frames: 1 },
    });
    expect(checkImageBounds(jpegBytes(1920, 1080), "image/jpeg")).toEqual({
      ok: true,
      info: { width: 1920, height: 1080, frames: 1 },
    });
    expect(checkImageBounds(gifBytes(32, 32, 3), "image/gif")).toEqual({
      ok: true,
      info: { width: 32, height: 32, frames: 3 },
    });
    expect(checkImageBounds(webpLosslessBytes(800, 600), "image/webp")).toEqual(
      { ok: true, info: { width: 800, height: 600, frames: 1 } },
    );
  });

  it("rejects PNG, JPEG and WebP that declare huge dimensions", () => {
    expect(checkImageBounds(pngBytes(60_000, 60_000), "image/png").ok).toBe(
      false,
    );
    expect(checkImageBounds(jpegBytes(65_535, 65_535), "image/jpeg").ok).toBe(
      false,
    );
    expect(
      checkImageBounds(webpLosslessBytes(16_383, 16_383), "image/webp").ok,
    ).toBe(false);
  });

  it("rejects images over the pixel budget even when each edge is allowed", () => {
    const edge = MAX_IMAGE_EDGE;
    const result = checkImageBounds(pngBytes(edge, edge), "image/png");
    expect(result.ok).toBe(false);
  });

  it("rejects GIFs with too many frames", () => {
    const result = checkImageBounds(
      gifBytes(10, 10, MAX_IMAGE_FRAMES + 1),
      "image/gif",
    );
    expect(result).toMatchObject({ ok: false });
  });

  it("rejects animated PNG and WebP over the frame limit", () => {
    expect(
      checkImageBounds(pngBytes(10, 10, { frames: 5_000 }), "image/png").ok,
    ).toBe(false);
    expect(
      checkImageBounds(webpAnimatedBytes(10, 10, 5_000), "image/webp").ok,
    ).toBe(false);
  });

  it("rejects animations whose total decoded size is too large", () => {
    // 5000x5000 (25 MP, allowed alone) x 100 frames = 2.5 GP.
    const result = checkImageBounds(gifBytes(5_000, 5_000, 100), "image/gif");
    expect(result.ok).toBe(false);
  });

  it("rejects zero dimensions and unreadable headers", () => {
    expect(checkImageBounds(pngBytes(0, 10), "image/png").ok).toBe(false);
    expect(
      checkImageBounds(
        Buffer.from([0xff, 0xd8, 0xff, 0xd9, 0, 0, 0, 0, 0, 0, 0, 0]),
        "image/jpeg",
      ).ok,
    ).toBe(false);
    expect(checkImageBounds(Buffer.alloc(20, 0x89), "image/png").ok).toBe(
      false,
    );
  });
});
