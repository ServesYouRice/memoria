// @vitest-environment happy-dom

import React from "react";
import { act, render, waitFor } from "@testing-library/react";
import { getSchema, type Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import Link from "@tiptap/extension-link";
import { describe, expect, it, vi } from "vitest";
import { collaborativeNoteSchema } from "@/lib/collaboration/sync/note-schema";
import { toCanonicalNoteDocument } from "@/lib/rich-text/editor-json";
import {
  normalizeNoteContent,
  type TiptapNode,
  type VersionedNoteContent,
} from "@/lib/rich-text/note-format";
import { RichTextEditor } from "@/components/RichTextEditor";

const CANONICAL: TiptapNode = {
  type: "doc",
  content: [
    { type: "paragraph", content: [{ type: "text", text: "first" }] },
    { type: "paragraph", content: [] },
    {
      type: "paragraph",
      content: [
        {
          type: "text",
          text: "link",
          marks: [{ type: "link", attrs: { href: "https://e.com/" } }],
        },
      ],
    },
    {
      type: "orderedList",
      content: [
        {
          type: "listItem",
          content: [
            { type: "paragraph", content: [{ type: "text", text: "one" }] },
          ],
        },
      ],
    },
    { type: "codeBlock", content: [{ type: "text", text: "let a = 1;" }] },
    {
      type: "heading",
      attrs: { level: 2 },
      content: [{ type: "text", text: "head" }],
    },
  ],
};

// The standalone editor's own extension set (RichTextEditor, not shared).
const standaloneSchema = getSchema([
  StarterKit.configure({ heading: { levels: [1, 2, 3] } }),
  Link.configure({
    openOnClick: false,
    HTMLAttributes: { target: "_blank", rel: "noopener noreferrer" },
  }),
]);

describe("toCanonicalNoteDocument", () => {
  for (const [name, schema] of [
    ["collaborative schema", collaborativeNoteSchema()],
    ["standalone editor schema", standaloneSchema],
  ] as const) {
    it(`normalizes real toJSON output (${name})`, () => {
      const json = schema.nodeFromJSON(CANONICAL).toJSON();
      // The raw serializer output is what the validator rejects.
      expect(() =>
        normalizeNoteContent({ formatVersion: 1, document: json }),
      ).toThrow();

      const result = normalizeNoteContent({
        formatVersion: 1,
        document: toCanonicalNoteDocument(json),
      });
      expect(result.document).toEqual(CANONICAL);
      // Dialog submit runs normalizeNoteContent(data.content) again.
      expect(normalizeNoteContent(result)).toEqual(result);
    });
  }

  it("passes unknown node and mark types through for the validator", () => {
    const adapted = toCanonicalNoteDocument({
      type: "doc",
      content: [
        { type: "image", attrs: { src: "x" } },
        {
          type: "paragraph",
          content: [
            { type: "text", text: "u", marks: [{ type: "underline" }] },
          ],
        },
      ],
    });
    expect(adapted.content?.[0]).toEqual({
      type: "image",
      attrs: { src: "x" },
    });
    expect(() =>
      normalizeNoteContent({ formatVersion: 1, document: adapted }),
    ).toThrow();
  });
});

describe("RichTextEditor (not shared)", () => {
  it("emits savable content for numbered lists, links, blank lines and code", async () => {
    const onChange = vi.fn<(content: VersionedNoteContent) => void>();
    const { container } = render(
      <RichTextEditor
        content={{
          formatVersion: 1,
          document: CANONICAL,
          plainText: "",
          text: "",
        }}
        onChange={onChange}
      />,
    );
    const dom = await waitFor(() => {
      const element = container.querySelector(".ProseMirror") as
        (HTMLElement & { editor?: Editor }) | null;
      expect(element?.editor).toBeDefined();
      return element!;
    });

    act(() => {
      dom.editor!.commands.insertContentAt(1, "x");
    });

    expect(onChange).toHaveBeenCalled();
    const emitted = onChange.mock.calls.at(-1)![0];
    expect(() => normalizeNoteContent(emitted)).not.toThrow();
    expect(emitted.plainText).toContain("xfirst");
    expect(emitted.text).toContain('<a href="https://e.com/">link</a>');
  });
});
