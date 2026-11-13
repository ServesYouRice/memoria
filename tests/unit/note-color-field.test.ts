/**
 * IMP-085: a note's colour is an optional field from a fixed list. It is
 * validated on the HTTP path, kept by the sync document, and refused when it
 * is not on the list or sits on another item type.
 */
import { describe, expect, it } from "vitest";
import * as Y from "yjs";
import { ItemType } from "@/types/canvas";
import { parseCanvasItemContent } from "@/lib/validation/canvas-item";
import { normalizeNoteContent } from "@/lib/rich-text/note-format";
import {
  applyItemState,
  createCanvasYDoc,
  createDocumentFromRows,
  documentItems,
  readItemState,
  type CanvasItemState,
} from "@/lib/collaboration/sync/document-items";
import {
  InvalidDocumentUpdateError,
  collectTouchedItems,
  validateTouchedItems,
} from "@/lib/collaboration/sync/validation";
import { NOTE_COLOR_KEY } from "@/lib/collaboration/sync/protocol";
import { NOTE_COLOR_NAMES, noteColorOf } from "@/lib/note-colors";

const DOCUMENT = {
  type: "doc",
  content: [{ type: "paragraph", content: [{ type: "text", text: "hello" }] }],
};

function note(id: string, color?: string): CanvasItemState {
  return {
    id,
    type: ItemType.NOTE,
    positionX: 0,
    positionY: 0,
    width: 200,
    height: 150,
    zIndex: 1,
    tags: [],
    content: { formatVersion: 1, document: DOCUMENT, color },
  };
}

function shape(id: string): CanvasItemState {
  return {
    ...note(id),
    type: ItemType.SHAPE,
    content: { shapeType: "rectangle" },
  };
}

function setup(rows: CanvasItemState[]) {
  const accepted = createDocumentFromRows(rows);
  const replica = createCanvasYDoc();
  Y.applyUpdate(replica, Y.encodeStateAsUpdate(accepted));
  const client = new Y.Doc();
  Y.applyUpdate(client, Y.encodeStateAsUpdate(accepted));
  function send(edit: (doc: Y.Doc) => void) {
    const before = Y.encodeStateVector(client);
    edit(client);
    const update = Y.encodeStateAsUpdate(client, before);
    let transaction: Y.Transaction | null = null;
    const capture = (tr: Y.Transaction) => {
      transaction = tr;
    };
    replica.on("afterTransaction", capture);
    Y.applyUpdate(replica, update);
    replica.off("afterTransaction", capture);
    return validateTouchedItems(
      collectTouchedItems(transaction!, documentItems(replica)),
      documentItems(accepted),
      documentItems(replica),
    );
  }
  return { client, send };
}

describe("note colour in stored content", () => {
  it.each(NOTE_COLOR_NAMES.filter((name) => name !== "yellow"))(
    "keeps %s",
    (color) => {
      const parsed = parseCanvasItemContent(ItemType.NOTE, {
        text: "hi",
        color,
      }) as { color?: string };
      expect(parsed.color).toBe(color);
    },
  );

  it("does not store the default yellow", () => {
    expect(
      normalizeNoteContent({ text: "hi", color: "yellow" }),
    ).not.toHaveProperty("color");
    expect(noteColorOf({ text: "hi" })).toBe("yellow");
  });

  it.each(["red", "#ff0000", 3, ""])("refuses %j", (color) => {
    expect(() =>
      parseCanvasItemContent(ItemType.NOTE, { text: "hi", color }),
    ).toThrow();
  });

  it("keeps the colour when the text is normalized again", () => {
    const first = normalizeNoteContent({ text: "<p>hi</p>", color: "blue" });
    expect(normalizeNoteContent(first).color).toBe("blue");
  });
});

describe("note colour in the shared document", () => {
  it("is written beside the note text and read back", () => {
    const doc = createDocumentFromRows([note("n1", "pink")]);
    const map = documentItems(doc).get("n1")!;
    expect(map.get(NOTE_COLOR_KEY)).toBe("pink");
    expect(readItemState("n1", map)?.content).toMatchObject({ color: "pink" });
  });

  it("is removed when the note goes back to yellow", () => {
    const doc = createDocumentFromRows([note("n1", "pink")]);
    doc.transact(() =>
      applyItemState(documentItems(doc), "n1", note("n1", "yellow")),
    );
    expect(documentItems(doc).get("n1")!.has(NOTE_COLOR_KEY)).toBe(false);
  });

  it("reaches the stored row when a collaborator recolours a note", () => {
    const { send } = setup([note("n1")]);
    const changes = send((doc) =>
      documentItems(doc).get("n1")!.set(NOTE_COLOR_KEY, "green"),
    );
    expect(changes).toEqual([
      expect.objectContaining({
        kind: "update",
        id: "n1",
        fields: { content: expect.objectContaining({ color: "green" }) },
      }),
    ]);
  });

  it.each([["red"], [42], ["yellow"]])(
    "refuses the colour %j",
    (color: unknown) => {
      const { send } = setup([note("n1")]);
      expect(() =>
        send((doc) => documentItems(doc).get("n1")!.set(NOTE_COLOR_KEY, color)),
      ).toThrow(InvalidDocumentUpdateError);
    },
  );

  it("refuses a note colour on another item type", () => {
    const { send } = setup([shape("s1")]);
    expect(() =>
      send((doc) => documentItems(doc).get("s1")!.set(NOTE_COLOR_KEY, "pink")),
    ).toThrow(InvalidDocumentUpdateError);
  });
});
