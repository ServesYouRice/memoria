/**
 * Row -> document reconciliation must not wipe a collaborative note whose
 * stored row (document + plainText + rendered HTML) is over the size limit
 * only because of the derived fields, nor any note it cannot normalize.
 */
import { describe, expect, it } from "vitest";
import type * as Y from "yjs";
import { ItemType } from "@/types/canvas";
import {
  applyItemState,
  createCanvasYDoc,
  documentItems,
  type CanvasItemState,
} from "@/lib/collaboration/sync/document-items";
import {
  noteDocumentFromContent,
  readNoteFragment,
} from "@/lib/collaboration/sync/note-fragment";
import {
  MAX_DOCUMENT_BYTES,
  normalizeNoteContent,
  type TiptapNode,
} from "@/lib/rich-text/note-format";

function linkedDocument(): TiptapNode {
  return {
    type: "doc",
    content: Array.from({ length: 150 }, (_, index) => ({
      type: "paragraph",
      content: [
        {
          type: "text",
          text: `see ${index}`,
          marks: [
            {
              type: "link",
              attrs: {
                href: `https://example.com/${"a".repeat(180)}/${index}`,
              },
            },
          ],
        },
      ],
    })),
  };
}

function noteState(content: unknown): CanvasItemState {
  return {
    id: "note-1",
    type: ItemType.NOTE,
    positionX: 0,
    positionY: 0,
    width: 200,
    height: 100,
    zIndex: 0,
    tags: [],
    content,
  } as CanvasItemState;
}

function docWithNote(document: TiptapNode) {
  const doc = createCanvasYDoc();
  const items = documentItems(doc);
  doc.transact(() =>
    applyItemState(items, "note-1", noteState({ formatVersion: 1, document })),
  );
  const fragment = items.get("note-1")!.get("text") as Y.XmlFragment;
  return { doc, items, fragment };
}

function updatesDuring(doc: Y.Doc, run: () => void): number {
  let count = 0;
  const listener = () => (count += 1);
  doc.on("update", listener);
  doc.transact(run);
  doc.off("update", listener);
  return count;
}

describe("note reconciliation", () => {
  it("keeps a note whose stored row is over the limit only because of derived text", () => {
    const { doc, items, fragment } = docWithNote(linkedDocument());
    // What projection stores for the note a client wrote.
    const stored = readNoteFragment(fragment);
    expect(
      JSON.stringify({ formatVersion: 1, document: stored.document }).length,
    ).toBeLessThan(MAX_DOCUMENT_BYTES);
    expect(JSON.stringify(stored).length).toBeGreaterThan(MAX_DOCUMENT_BYTES);
    expect(() => normalizeNoteContent(stored)).toThrow();

    expect(noteDocumentFromContent(stored)).toEqual(
      readNoteFragment(fragment).document,
    );
    const before = readNoteFragment(fragment).plainText;
    expect(
      updatesDuring(doc, () =>
        applyItemState(items, "note-1", noteState(stored)),
      ),
    ).toBe(0);
    expect(readNoteFragment(fragment).plainText).toBe(before);
  });

  it("leaves an existing note untouched when the row cannot be normalized", () => {
    const { doc, items, fragment } = docWithNote({
      type: "doc",
      content: [
        { type: "paragraph", content: [{ type: "text", text: "Keep me" }] },
      ],
    });
    expect(
      updatesDuring(doc, () =>
        applyItemState(
          items,
          "note-1",
          noteState({ formatVersion: 1, document: { type: "bogus" } }),
        ),
      ),
    ).toBe(0);
    expect(readNoteFragment(fragment).plainText).toBe("Keep me");
  });
});
