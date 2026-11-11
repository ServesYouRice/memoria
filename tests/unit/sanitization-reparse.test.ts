import { load } from "cheerio";
import { describe, expect, it } from "vitest";
import {
  sanitizeComment,
  sanitizeMarkdown,
  sanitizeNoteHtml,
} from "@/lib/sanitization";

const PAYLOADS = [
  "hi <textarea><img src=x onerror=alert(1)></textarea>",
  "<div>hi &lt;img src=x onerror=alert(1)&gt;</div>",
  "<title><img src=x onerror=alert(1)></title>",
  "<noscript><img src=x onerror=alert(1)></noscript>",
  "<xmp><img src=x onerror=alert(1)></xmp>",
  "<iframe><img src=x onerror=alert(1)></iframe>",
  "<div><div>&lt;script&gt;alert(1)&lt;/script&gt;</div></div>",
  "<span>&lt;a href=javascript:alert(1)&gt;x&lt;/a&gt;</span>",
];

const SANITIZERS = { sanitizeNoteHtml, sanitizeComment, sanitizeMarkdown };

function parsedTags(html: string) {
  const $ = load(`<div id="out">${html}</div>`, null, false);
  return $("#out")
    .find("*")
    .toArray()
    .map((element) => ({
      tag: element.tagName.toLowerCase(),
      attrs: Object.keys(element.attribs),
    }));
}

describe("sanitizeAllowedHtml never re-parses decoded text as markup", () => {
  for (const [name, sanitize] of Object.entries(SANITIZERS)) {
    for (const payload of PAYLOADS) {
      it(`${name}: ${payload}`, () => {
        const output = sanitize(payload);
        const tags = parsedTags(output);
        expect(tags.map((t) => t.tag)).not.toContain("img");
        expect(tags.map((t) => t.tag)).not.toContain("script");
        expect(tags.flatMap((t) => t.attrs)).not.toContain("onerror");
        expect(tags.filter((t) => t.tag === "a")).toEqual([]);
        // The visible text is kept, not dropped.
        expect(load(output).text()).toMatch(/alert\(1\)/);
      });
    }
  }

  it("keeps allowed markup", () => {
    const output = sanitizeNoteHtml(
      '<p><strong>a</strong> <a href="https://e.com">l</a></p>',
    );
    expect(parsedTags(output)).toEqual([
      { tag: "p", attrs: [] },
      { tag: "strong", attrs: [] },
      { tag: "a", attrs: ["href"] },
    ]);
    expect(output).toContain('href="https://e.com"');
  });

  it("still drops script and style with their content", () => {
    expect(
      sanitizeComment("a<script>alert(1)</script><style>p{}</style>b"),
    ).toBe("ab");
  });
});
