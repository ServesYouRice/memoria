// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";

import { stripHtmlTags } from "./html";

describe("stripHtmlTags (browser path)", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    delete (window as unknown as { __x?: number }).__x;
  });

  it("returns the text of plain and nested markup with entities decoded", () => {
    expect(stripHtmlTags("plain")).toBe("plain");
    expect(
      stripHtmlTags("<p>Hello <strong>bold <em>it</em></strong></p>"),
    ).toBe("Hello bold it");
    expect(stripHtmlTags("<p>a &amp; b &lt;c&gt;</p>")).toBe("a & b <c>");
  });

  it("parses untrusted markup in an inert document, not the live one", () => {
    const createElement = vi.spyOn(document, "createElement");

    const text = stripHtmlTags('<p>a</p><img src=x onerror="window.__x=1">b');

    expect(text).toBe("ab");
    expect((window as unknown as { __x?: number }).__x).toBeUndefined();
    expect(createElement).not.toHaveBeenCalled();
  });
});
