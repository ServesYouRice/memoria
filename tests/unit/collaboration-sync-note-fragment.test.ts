/**
 * IMP-042: note text travels as a y-prosemirror XML fragment. The server must
 * read exactly what TipTap writes, refuse anything outside the note format,
 * and write stored notes back in the shape TipTap renders.
 */

import { describe, expect, it } from "vitest";
import * as Y from "yjs";
import { prosemirrorJSONToYXmlFragment } from "@tiptap/y-tiptap";
import { collaborativeNoteSchema } from "@/lib/collaboration/sync/note-schema";
import {
  NoteFragmentError,
  noteDocumentFromContent,
  readNoteFragment,
  writeNoteFragment,
} from "@/lib/collaboration/sync/note-fragment";
import type { TiptapNode } from "@/lib/rich-text/note-format";

function fragmentFromEditorJson(json: unknown): Y.XmlFragment {
  const doc = new Y.Doc();
  const fragment = doc.getXmlFragment("text");
  prosemirrorJSONToYXmlFragment(collaborativeNoteSchema(), json, fragment);
  return fragment;
}

const RICH_DOCUMENT = {
  type: "doc",
  content: [
    {
      type: "heading",
      attrs: { level: 2 },
      content: [{ type: "text", text: "Plan" }],
    },
    {
      type: "paragraph",
      content: [
        { type: "text", text: "Ship " },
        { type: "text", text: "today", marks: [{ type: "bold" }] },
        { type: "hardBreak" },
        {
          type: "text",
          text: "docs",
          marks: [
            {
              type: "link",
              attrs: {
                href: "https://example.com/docs",
                target: "_blank",
                rel: "noopener noreferrer",
                class: null,
                title: null,
              },
            },
            { type: "italic" },
          ],
        },
      ],
    },
    {
      type: "orderedList",
      attrs: { start: 3, type: null },
      content: [
        {
          type: "listItem",
          content: [
            { type: "paragraph", content: [{ type: "text", text: "one" }] },
          ],
        },
      ],
    },
    {
      type: "codeBlock",
      attrs: { language: "ts" },
      content: [{ type: "text", text: "const a = 1;" }],
    },
  ],
};

describe("readNoteFragment", () => {
  it("reads TipTap's encoding into the strict note format", () => {
    const content = readNoteFragment(fragmentFromEditorJson(RICH_DOCUMENT));

    expect(content.formatVersion).toBe(1);
    expect(content.plainText).toContain("Ship today");
    expect(content.document.content?.[0]).toEqual({
      type: "heading",
      attrs: { level: 2 },
      content: [{ type: "text", text: "Plan" }],
    });
    const paragraph = content.document.content?.[1];
    expect(paragraph?.content?.[1]).toEqual({
      type: "text",
      text: "today",
      marks: [{ type: "bold" }],
    });
    expect(paragraph?.content?.[2]).toEqual({ type: "hardBreak" });
    // Link attributes TipTap adds are accepted and reduced to the stored href.
    expect(paragraph?.content?.[3]).toEqual({
      type: "text",
      text: "docs",
      marks: [
        { type: "link", attrs: { href: "https://example.com/docs" } },
        { type: "italic" },
      ],
    });
    expect(content.document.content?.[2]?.attrs).toBeUndefined();
    expect(content.text).toContain("<h2>Plan</h2>");
  });

  it("accepts the empty note an editor passes through while typing", () => {
    const doc = new Y.Doc();
    const fragment = doc.getXmlFragment("text");
    expect(readNoteFragment(fragment).plainText).toBe("");
    fragment.insert(0, [new Y.XmlElement("paragraph")]);
    expect(readNoteFragment(fragment).document).toEqual({
      type: "doc",
      content: [{ type: "paragraph", content: [] }],
    });
  });

  it.each([
    [
      "unknown nodes",
      () => {
        const fragment = new Y.Doc().getXmlFragment("text");
        fragment.insert(0, [new Y.XmlElement("script")]);
        return fragment;
      },
    ],
    [
      "unsafe links",
      () => {
        const fragment = new Y.Doc().getXmlFragment("text");
        const paragraph = new Y.XmlElement("paragraph");
        fragment.insert(0, [paragraph]);
        const text = new Y.XmlText();
        paragraph.insert(0, [text]);
        text.insert(0, "click", { link: { href: "javascript:alert(1)" } });
        return fragment;
      },
    ],
    [
      "unsupported marks",
      () => {
        const fragment = new Y.Doc().getXmlFragment("text");
        const paragraph = new Y.XmlElement("paragraph");
        fragment.insert(0, [paragraph]);
        const text = new Y.XmlText();
        paragraph.insert(0, [text]);
        text.insert(0, "under", { underline: {} });
        return fragment;
      },
    ],
    [
      "unexpected attributes",
      () => {
        const fragment = new Y.Doc().getXmlFragment("text");
        const paragraph = new Y.XmlElement("paragraph");
        paragraph.setAttribute("style", "color:red");
        fragment.insert(0, [paragraph]);
        return fragment;
      },
    ],
    [
      "embedded objects in text",
      () => {
        const fragment = new Y.Doc().getXmlFragment("text");
        const paragraph = new Y.XmlElement("paragraph");
        fragment.insert(0, [paragraph]);
        const text = new Y.XmlText();
        paragraph.insert(0, [text]);
        text.insertEmbed(0, { image: "x" });
        return fragment;
      },
    ],
    [
      "too many nodes",
      () => {
        const fragment = new Y.Doc().getXmlFragment("text");
        fragment.insert(
          0,
          Array.from({ length: 1_001 }, () => new Y.XmlElement("paragraph")),
        );
        return fragment;
      },
    ],
  ])("refuses %s", (_label, build) => {
    expect(() => readNoteFragment(build())).toThrow(NoteFragmentError);
  });
});

describe("writeNoteFragment", () => {
  it("round-trips stored notes and keeps unchanged blocks", () => {
    const doc = new Y.Doc();
    const fragment = doc.getXmlFragment("text");
    const stored = noteDocumentFromContent({
      formatVersion: 1,
      document: RICH_DOCUMENT,
    });
    // Stored link marks carry only href; the strict validator drops the rest.
    const strict = noteDocumentFromContent({
      formatVersion: 1,
      document: readNoteFragment(fragmentFromEditorJson(RICH_DOCUMENT))
        .document,
    });
    doc.transact(() => writeNoteFragment(fragment, strict));
    expect(readNoteFragment(fragment).document).toEqual(strict);
    expect(stored.type).toBe("doc");

    const heading = fragment.get(0);
    const edited: TiptapNode = {
      ...strict,
      content: [
        ...(strict.content ?? []),
        { type: "paragraph", content: [{ type: "text", text: "more" }] },
      ],
    };
    doc.transact(() => writeNoteFragment(fragment, edited));
    expect(readNoteFragment(fragment).document).toEqual(edited);
    // The diff kept the untouched heading rather than rebuilding the note.
    expect(fragment.get(0)).toBe(heading);
  });

  it("converts legacy HTML notes", () => {
    const document = noteDocumentFromContent({ text: "<p>Hello <b>x</b></p>" });
    const fragment = new Y.Doc().getXmlFragment("text");
    writeNoteFragment(fragment, document);
    expect(readNoteFragment(fragment).plainText).toBe("Hello x");
  });
});
