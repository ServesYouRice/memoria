import { describe, expect, it } from "vitest";
import { normalizeNoteContent } from "@/lib/rich-text/note-format";

describe("legacy HTML note conversion keeps structure and decodes text", () => {
  it("VAL-249: paragraphs, lists, marks, links and entities", () => {
    const result = normalizeNoteContent({
      text: '<p>A &amp; B</p><ul><li><strong>x</strong></li></ul><p><a href="https://e.com">l</a></p>',
    });
    expect(result.document).toEqual({
      type: "doc",
      content: [
        { type: "paragraph", content: [{ type: "text", text: "A & B" }] },
        {
          type: "bulletList",
          content: [
            {
              type: "listItem",
              content: [
                {
                  type: "paragraph",
                  content: [
                    { type: "text", text: "x", marks: [{ type: "bold" }] },
                  ],
                },
              ],
            },
          ],
        },
        {
          type: "paragraph",
          content: [
            {
              type: "text",
              text: "l",
              marks: [{ type: "link", attrs: { href: "https://e.com" } }],
            },
          ],
        },
      ],
    });
    expect(result.plainText).toContain("A & B");
    expect(result.plainText).not.toContain("&amp;");
    expect(result.text).toBe(
      '<p>A &amp; B</p><ul><li><p><strong>x</strong></p></li></ul><p><a href="https://e.com">l</a></p>',
    );
  });

  it("headings, blockquote, pre, hard breaks and nested marks", () => {
    const result = normalizeNoteContent({
      text: "<h2>Title</h2><blockquote>quoted <em>it</em></blockquote><pre>a  &lt;b&gt;\n c</pre><p>one<br>two <s><code>z</code></s></p><ol><li>i<ul><li>j</li></ul></li></ol>",
    });
    expect(result.document.content).toEqual([
      {
        type: "heading",
        attrs: { level: 2 },
        content: [{ type: "text", text: "Title" }],
      },
      {
        type: "blockquote",
        content: [
          {
            type: "paragraph",
            content: [
              { type: "text", text: "quoted " },
              { type: "text", text: "it", marks: [{ type: "italic" }] },
            ],
          },
        ],
      },
      { type: "codeBlock", content: [{ type: "text", text: "a  <b>\n c" }] },
      {
        type: "paragraph",
        content: [
          { type: "text", text: "one" },
          { type: "hardBreak" },
          { type: "text", text: "two " },
          {
            type: "text",
            text: "z",
            marks: [{ type: "strike" }, { type: "code" }],
          },
        ],
      },
      {
        type: "orderedList",
        content: [
          {
            type: "listItem",
            content: [
              { type: "paragraph", content: [{ type: "text", text: "i" }] },
              {
                type: "bulletList",
                content: [
                  {
                    type: "listItem",
                    content: [
                      {
                        type: "paragraph",
                        content: [{ type: "text", text: "j" }],
                      },
                    ],
                  },
                ],
              },
            ],
          },
        ],
      },
    ]);
    expect(result.plainText).toContain("a  <b>");
  });

  it("returns text = rendered document and is stable when normalized again", () => {
    const first = normalizeNoteContent({
      text: "<p>Tom &amp; Jerry</p><p>second <a href='javascript:alert(1)'>bad</a></p>",
    });
    expect(first.text).not.toContain("javascript");
    const second = normalizeNoteContent(first);
    expect(second).toEqual(first);
  });

  it("keeps plain-text lines from legacy text without tags", () => {
    const result = normalizeNoteContent({ text: "first & co\nsecond" });
    expect(result.plainText).toBe("first & co\nsecond");
  });

  it("still rejects empty and over-long legacy notes", () => {
    expect(() => normalizeNoteContent({ text: "<p> </p>" })).toThrow(
      "Note text cannot be empty.",
    );
    expect(() =>
      normalizeNoteContent({ text: `<p>${"a".repeat(20_001)}</p>` }),
    ).toThrow(/too long|too large/);
  });
});

describe("legacy conversion fallback", () => {
  it("keeps the text when the structure is too deep or too large", () => {
    const deep = `${"<blockquote>".repeat(20)}deep${"</blockquote>".repeat(20)}`;
    expect(normalizeNoteContent({ text: deep }).plainText).toBe("deep");
    const many = Array.from({ length: 600 }, (_, i) => `<p>p${i}</p>`).join("");
    const result = normalizeNoteContent({ text: many });
    expect(result.plainText).toContain("p599");
    expect(normalizeNoteContent(result)).toEqual(result);
  });
});
