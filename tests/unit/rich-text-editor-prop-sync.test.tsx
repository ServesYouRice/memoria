// @vitest-environment happy-dom

import React from "react";
import { act, render, waitFor } from "@testing-library/react";
import type { Editor } from "@tiptap/core";
import { describe, expect, it } from "vitest";
import {
  RichTextEditor,
  noteDocumentsEqual,
} from "@/components/RichTextEditor";
import type {
  TiptapNode,
  VersionedNoteContent,
} from "@/lib/rich-text/note-format";

const BOLD_DOC: TiptapNode = {
  type: "doc",
  content: [
    {
      type: "paragraph",
      content: [
        { type: "text", text: "plain " },
        { type: "text", text: "bold", marks: [{ type: "bold" }] },
      ],
    },
    { type: "paragraph", content: [] },
  ],
};

describe("noteDocumentsEqual", () => {
  it("ignores key order, missing empty content and mark order", () => {
    expect(
      noteDocumentsEqual(
        {
          type: "doc",
          content: [
            {
              type: "paragraph",
              content: [
                {
                  marks: [{ type: "italic" }, { type: "bold" }],
                  type: "text",
                  text: "a",
                },
              ],
            },
            { type: "paragraph" },
          ],
        },
        {
          type: "doc",
          content: [
            {
              type: "paragraph",
              content: [
                {
                  type: "text",
                  text: "a",
                  marks: [{ type: "bold" }, { type: "italic" }],
                },
              ],
            },
            { type: "paragraph", content: [] },
          ],
        },
      ),
    ).toBe(true);
  });

  it("tells different documents apart", () => {
    expect(
      noteDocumentsEqual(BOLD_DOC, {
        type: "doc",
        content: [
          { type: "paragraph", content: [{ type: "text", text: "other" }] },
        ],
      }),
    ).toBe(false);
  });
});

function ControlledEditor({
  initial,
  onEditor,
  external,
}: {
  initial: VersionedNoteContent;
  onEditor: (editor: Editor) => void;
  external?: VersionedNoteContent;
}) {
  const [content, setContent] = React.useState(initial);
  React.useEffect(() => {
    if (external) setContent(external);
  }, [external]);
  const ref = React.useRef<HTMLDivElement>(null);
  React.useEffect(() => {
    const element = ref.current?.querySelector(".ProseMirror") as
      (HTMLElement & { editor?: Editor }) | null;
    if (element?.editor) onEditor(element.editor);
  });
  return (
    <div ref={ref}>
      <RichTextEditor content={content} onChange={setContent} />
    </div>
  );
}

describe("RichTextEditor prop sync (not shared)", () => {
  const initial: VersionedNoteContent = {
    formatVersion: 1,
    document: BOLD_DOC,
    plainText: "plain bold",
    text: "<p>plain <strong>bold</strong></p><p></p>",
  };

  async function mount(external?: VersionedNoteContent) {
    let editor: Editor | undefined;
    const view = render(
      <ControlledEditor
        initial={initial}
        external={external}
        onEditor={(value) => {
          editor = value;
        }}
      />,
    );
    await waitFor(() => expect(editor).toBeDefined());
    const resets: number[] = [];
    editor!.on("transaction", ({ transaction }) => {
      if (transaction.getMeta("preventUpdate")) resets.push(1);
    });
    return { editor: editor!, resets, view };
  }

  it("does not replace the document it emitted while typing bold text", async () => {
    const { editor, resets } = await mount();

    act(() => {
      editor.chain().setTextSelection(3).insertContent("x").run();
    });
    await act(async () => {});

    expect(resets).toEqual([]);
    expect(editor.state.selection.from).toBe(4);
    expect(editor.getText()).toContain("plxain");
  });

  it("still loads a genuinely different document from props", async () => {
    let editor: Editor | undefined;
    const other: VersionedNoteContent = {
      formatVersion: 1,
      document: {
        type: "doc",
        content: [
          { type: "paragraph", content: [{ type: "text", text: "other" }] },
        ],
      },
      plainText: "other",
      text: "<p>other</p>",
    };
    const { rerender } = render(
      <ControlledEditor
        initial={initial}
        onEditor={(value) => {
          editor = value;
        }}
      />,
    );
    await waitFor(() => expect(editor).toBeDefined());
    rerender(
      <ControlledEditor
        initial={initial}
        external={other}
        onEditor={(value) => {
          editor = value;
        }}
      />,
    );
    await waitFor(() => expect(editor!.getText()).toBe("other"));
  });
});
