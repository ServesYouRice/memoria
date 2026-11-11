import { describe, expect, it } from "vitest";
import { normalizeNoteContent } from "@/lib/rich-text/note-format";

function paragraphTexts(document: {
  content?: { type: string; content?: { type: string; text?: string }[] }[];
}) {
  return (document.content ?? []).map((block) =>
    (block.content ?? [])
      .map((child) => (child.type === "hardBreak" ? "\n" : (child.text ?? "")))
      .join(""),
  );
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
