import { describe, expect, it } from "vitest";
import { extractMetadata } from "@/lib/utils/metadata-extractor";

describe("metadata extractor URL schemes (TASK-041)", () => {
  it.each([
    "javascript:alert(1)",
    "data:image/png;base64,AAAA",
    "file:///etc/passwd",
  ])("drops a %s image and favicon", (url) => {
    const metadata = extractMetadata(
      `<html><head><meta property="og:image" content="${url}"><link rel="icon" href="${url}"></head></html>`,
      "https://example.com/page",
    );
    expect(metadata.image).toBeUndefined();
    expect(metadata.favicon).toBe("https://example.com/favicon.ico");
  });

  it("keeps an http(s) image resolved against the page", () => {
    const metadata = extractMetadata(
      '<html><head><meta property="og:image" content="/a.png"></head></html>',
      "https://example.com/page",
    );
    expect(metadata.image).toBe("https://example.com/a.png");
  });
});
