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

/**
 * The text of each text block (paragraph, heading, code block) in document
 * order, through lists and quotes, with hard breaks as newlines.
 */
type BlockNode = { type: string; text?: string; content?: BlockNode[] };
function paragraphTexts(document: BlockNode) {
  const texts: string[] = [];
  const walk = (node: BlockNode) => {
    if (["paragraph", "heading", "codeBlock"].includes(node.type)) {
      texts.push(
        (node.content ?? [])
          .map((child) =>
            child.type === "hardBreak" ? "\n" : (child.text ?? ""),
          )
          .join(""),
      );
      return;
    }
    for (const child of node.content ?? []) walk(child);
  };
  for (const block of document.content ?? []) walk(block);
  return texts;
}

describe("legacy note conversion (VAL-263)", () => {
  it("decodes entities and keeps one paragraph per block", () => {
    const result = normalizeNoteContent({
      text: "<p>Tom &amp; Jerry</p><p>Next</p>",
    });
    expect(result.plainText).toBe("Tom & Jerry\nNext");
    expect(result.document.content).toHaveLength(2);
    expect(paragraphTexts(result.document)).toEqual(["Tom & Jerry", "Next"]);

    const rendered = normalizeNoteContent({
      formatVersion: 1,
      document: result.document,
    }).text;
    expect(rendered).toBe("<p>Tom &amp; Jerry</p><p>Next</p>");
    expect(rendered).not.toContain("&amp;amp;");
  });

  it("decodes a raw ampersand, nbsp and &lt; without double escaping", () => {
    const result = normalizeNoteContent({
      text: "<p>Tom & Jerry</p><p>a&nbsp;b</p><p>1 &lt; 2</p>",
    });
    expect(result.plainText).toBe("Tom & Jerry\na b\n1 < 2");
    expect(paragraphTexts(result.document)).toEqual([
      "Tom & Jerry",
      "a b",
      "1 < 2",
    ]);
    expect(
      normalizeNoteContent({ formatVersion: 1, document: result.document })
        .text,
    ).toBe("<p>Tom &amp; Jerry</p><p>a b</p><p>1 &lt; 2</p>");
  });

  it("keeps an empty paragraph as an empty block", () => {
    const result = normalizeNoteContent({
      text: "<p>First</p><p></p><p>Last</p>",
    });
    expect(result.document.content).toEqual([
      { type: "paragraph", content: [{ type: "text", text: "First" }] },
      { type: "paragraph", content: [] },
      { type: "paragraph", content: [{ type: "text", text: "Last" }] },
    ]);
    expect(result.plainText).toBe("First\n\nLast");
  });

  it("splits list items, headings and line breaks into blocks", () => {
    const result = normalizeNoteContent({
      text: "<h1>Title</h1><ul><li>one</li><li>two</li></ul><p>a<br>b</p>",
    });
    expect(paragraphTexts(result.document)).toEqual([
      "Title",
      "one",
      "two",
      "a\nb",
    ]);
    expect(result.plainText).toBe("Title\none\ntwo\na\nb");
  });

  it("still rejects a legacy note with no text", () => {
    expect(() => normalizeNoteContent({ text: "<p></p><p> </p>" })).toThrow(
      "Note text cannot be empty.",
    );
  });
});
