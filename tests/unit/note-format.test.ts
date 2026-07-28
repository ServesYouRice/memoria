import { describe, expect, it } from "vitest";
import { normalizeNoteContent } from "@/lib/rich-text/note-format";

describe("versioned note format", () => {
  it("round-trips supported Tiptap JSON and derives readable projections", () => {
    const document = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            { type: "text", text: "Hello ", marks: [{ type: "bold" }] },
            {
              type: "text",
              text: "world",
              marks: [{ type: "link", attrs: { href: "https://example.com" } }],
            },
          ],
        },
      ],
    };
    const result = normalizeNoteContent({ formatVersion: 1, document });
    expect(result.document).toEqual(document);
    expect(result.plainText).toBe("Hello world");
    expect(result.text).toBe(
      '<p><strong>Hello </strong><a href="https://example.com">world</a></p>',
    );
  });

  it("migrates legacy HTML without allowing executable markup", () => {
    const result = normalizeNoteContent({
      text: "<p>Hello <strong>world</strong><script>alert(1)</script></p>",
    });
    expect(result.formatVersion).toBe(1);
    expect(result.text).toBe("<p>Hello <strong>world</strong></p>");
    expect(result.plainText).toBe("Hello world");
  });

  it.each([
    {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            {
              type: "text",
              text: "bad",
              marks: [{ type: "link", attrs: { href: "javascript:alert(1)" } }],
            },
          ],
        },
      ],
    },
    {
      type: "doc",
      content: [{ type: "image", attrs: { src: "x" }, content: [] }],
    },
  ])("rejects unsafe or unsupported documents", (document) => {
    expect(() =>
      normalizeNoteContent({ formatVersion: 1, document }),
    ).toThrow();
  });
});
