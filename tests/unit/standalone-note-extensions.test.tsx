// @vitest-environment happy-dom

import React from "react";
import { render, waitFor } from "@testing-library/react";
import type { Editor } from "@tiptap/core";
import { describe, expect, it, vi } from "vitest";
import { collaborativeNoteSchema } from "@/lib/collaboration/sync/note-schema";
import { RichTextEditor } from "@/components/RichTextEditor";

async function mountStandaloneEditor() {
  const { container } = render(
    <RichTextEditor content={null} onChange={vi.fn()} />,
  );
  return waitFor(() => {
    const element = container.querySelector(".ProseMirror") as
      (HTMLElement & { editor?: Editor }) | null;
    expect(element?.editor).toBeDefined();
    return element!.editor!;
  });
}

describe("non-shared RichTextEditor extensions", () => {
  it("matches the collaborative note schema and keeps history", async () => {
    const editor = await mountStandaloneEditor();
    const shared = collaborativeNoteSchema();

    expect(Object.keys(editor.schema.nodes).sort()).toEqual(
      Object.keys(shared.nodes).sort(),
    );
    expect(Object.keys(editor.schema.marks).sort()).toEqual(
      Object.keys(shared.marks).sort(),
    );
    expect(editor.schema.marks.underline).toBeUndefined();
    expect(editor.schema.nodes.horizontalRule).toBeUndefined();

    const names = editor.extensionManager.extensions.map((ext) => ext.name);
    expect(names.filter((name) => name === "link")).toHaveLength(1);
    expect(names).toContain("undoRedo");
  });
});
