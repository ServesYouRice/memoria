import { afterEach, describe, expect, it, vi } from "vitest";
import { buildCSP } from "@/middleware/csp";
import { buildImageProxyPath, toImageProxyUrl } from "@/lib/images/proxy-url";
import {
  signImageProxyUrl,
  verifyImageProxySignature,
  withSignedImageProxyUrls,
} from "@/lib/images/signed-proxy";
import { sniffImageType } from "@/lib/images/sniff";
import { ItemType } from "@/types/canvas";

function imgSrc(csp: string): string[] {
  const directive = csp.split("; ").find((part) => part.startsWith("img-src "));
  return directive ? directive.split(" ").slice(1) : [];
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("CSP img-src (IMP-057)", () => {
  it("does not allow arbitrary https: images", () => {
    vi.stubEnv("UPLOADS_PUBLIC_URL", "");
    const sources = imgSrc(buildCSP("nonce"));

    expect(sources).toEqual(["'self'", "data:", "blob:"]);
    expect(buildCSP("nonce")).not.toMatch(/img-src[^;]*\bhttps:/);
  });

  it("adds only the configured public upload storage origin", () => {
    vi.stubEnv(
      "UPLOADS_PUBLIC_URL",
      "https://uploads.example.com/memoria-uploads/",
    );

    expect(imgSrc(buildCSP("nonce"))).toEqual([
      "'self'",
      "data:",
      "blob:",
      "https://uploads.example.com",
    ]);
  });

  it.each(["not a url", "javascript:alert(1)", "ftp://files.example.com"])(
    "ignores the unusable storage URL %j",
    (value) => {
      vi.stubEnv("UPLOADS_PUBLIC_URL", value);
      expect(imgSrc(buildCSP("nonce"))).toEqual(["'self'", "data:", "blob:"]);
    },
  );
});

describe("toImageProxyUrl", () => {
  it("routes remote images through the same-origin proxy", () => {
    expect(toImageProxyUrl("https://example.com/a.png?x=1&y=2")).toBe(
      "/api/v1/image-proxy?url=https%3A%2F%2Fexample.com%2Fa.png%3Fx%3D1%26y%3D2",
    );
    expect(toImageProxyUrl("http://example.com/favicon.ico")).toBe(
      buildImageProxyPath("http://example.com/favicon.ico"),
    );
  });

  it("leaves same-origin, data and blob sources alone", () => {
    expect(toImageProxyUrl("/api/v1/uploads/cabc")).toBe(
      "/api/v1/uploads/cabc",
    );
    expect(toImageProxyUrl("data:image/png;base64,AAAA")).toBe(
      "data:image/png;base64,AAAA",
    );
    expect(toImageProxyUrl("blob:http://localhost/1")).toBe(
      "blob:http://localhost/1",
    );
    const signed = buildImageProxyPath("https://example.com/a.png", "sig");
    expect(toImageProxyUrl(signed)).toBe(signed);
  });

  it.each([
    null,
    undefined,
    "",
    "  ",
    "//evil.example/a.png",
    "javascript:alert(1)",
    "data:text/html,<script>alert(1)</script>",
    `https://example.com/${"a".repeat(2100)}`,
  ])("drops the unusable source %j", (value) => {
    expect(toImageProxyUrl(value)).toBeUndefined();
  });
});

describe("signed image proxy URLs", () => {
  it("verifies only the exact signed URL", () => {
    const url = "https://example.com/a.png";
    const signature = signImageProxyUrl(url);

    expect(verifyImageProxySignature(url, signature)).toBe(true);
    expect(verifyImageProxySignature(`${url}?x`, signature)).toBe(false);
    expect(verifyImageProxySignature(url, "x".repeat(43))).toBe(false);
    expect(verifyImageProxySignature(url, undefined)).toBe(false);
  });

  it("signs remote image fields of read-only items and nothing else", () => {
    const items = [
      {
        id: "1",
        type: ItemType.IMAGE,
        content: { url: "https://cdn.example.com/p.jpg", filename: "p.jpg" },
      },
      {
        id: "2",
        type: ItemType.IMAGE,
        content: { url: "/api/v1/uploads/cabc?embed=t", filename: "u.png" },
      },
      {
        id: "3",
        type: ItemType.BOOKMARK,
        content: {
          url: "https://example.com/article",
          favicon: "https://example.com/favicon.ico",
          previewImage: "https://example.com/og.png",
        },
      },
      { id: "4", type: ItemType.NOTE, content: { text: "https://x.y/z.png" } },
    ];

    const [image, upload, bookmark, note] = withSignedImageProxyUrls(items);

    const imageUrl = new URL(
      (image!.content as { url: string }).url,
      "http://localhost",
    );
    expect(imageUrl.pathname).toBe("/api/v1/image-proxy");
    expect(imageUrl.searchParams.get("url")).toBe(
      "https://cdn.example.com/p.jpg",
    );
    expect(
      verifyImageProxySignature(
        "https://cdn.example.com/p.jpg",
        imageUrl.searchParams.get("sig"),
      ),
    ).toBe(true);

    expect(upload).toBe(items[1]);
    const bookmarkContent = bookmark!.content as Record<string, string>;
    expect(bookmarkContent.url).toBe("https://example.com/article");
    expect(bookmarkContent.favicon).toMatch(/^\/api\/v1\/image-proxy\?url=/);
    expect(bookmarkContent.previewImage).toMatch(
      /^\/api\/v1\/image-proxy\?url=.*&sig=/,
    );
    expect(note).toBe(items[3]);
    // The input is not mutated.
    expect(items[0]!.content.url).toBe("https://cdn.example.com/p.jpg");
  });
});

describe("sniffImageType", () => {
  const pad = (bytes: number[] | string) =>
    Buffer.concat([
      typeof bytes === "string"
        ? Buffer.from(bytes, "binary")
        : Buffer.from(bytes),
      Buffer.alloc(16),
    ]);

  it.each([
    [[0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], "image/png"],
    [[0xff, 0xd8, 0xff, 0xe0], "image/jpeg"],
    ["GIF89a", "image/gif"],
    ["RIFF\x00\x00\x00\x00WEBPVP8 ", "image/webp"],
    ["\x00\x00\x00\x1cftypavif", "image/avif"],
    [[0x00, 0x00, 0x01, 0x00, 0x01, 0x00], "image/x-icon"],
  ] as const)("detects %j as %s", (bytes, type) => {
    expect(sniffImageType(pad(bytes as number[] | string))).toBe(type);
  });

  it.each([
    '<svg xmlns="http://www.w3.org/2000/svg"></svg>',
    '<?xml version="1.0"?><svg></svg>',
    "<!doctype html><html></html>",
    "%PDF-1.7 plus some padding",
  ])("rejects %j", (text) => {
    expect(sniffImageType(Buffer.from(text))).toBeNull();
  });

  it("rejects truncated bodies", () => {
    expect(sniffImageType(Buffer.from([0xff, 0xd8, 0xff]))).toBeNull();
  });
});
