import { describe, expect, it } from "vitest";
import * as Y from "yjs";
import { ItemType } from "@/types/canvas";
import {
  applyItemState,
  createCanvasYDoc,
  createDocumentFromRows,
  documentItems,
  type CanvasItemState,
} from "@/lib/collaboration/sync/document-items";
import {
  InvalidDocumentUpdateError,
  collectTouchedItems,
  validateTouchedItems,
} from "@/lib/collaboration/sync/validation";
import { createCanvasItemId } from "@/lib/collaboration/sync/protocol";

function shape(
  id: string,
  overrides: Partial<CanvasItemState> = {},
): CanvasItemState {
  return {
    id,
    type: ItemType.SHAPE,
    positionX: 0,
    positionY: 0,
    width: 40,
    height: 40,
    zIndex: 1,
    tags: [],
    content: { shapeType: "rectangle" },
    ...overrides,
  };
}

function note(id: string, text: string): CanvasItemState {
  return {
    ...shape(id),
    type: ItemType.NOTE,
    content: {
      formatVersion: 1,
      document: {
        type: "doc",
        content: [{ type: "paragraph", content: [{ type: "text", text }] }],
      },
    },
  };
}

/**
 * Mirror the sync engine: the accepted document, a replica of it, and a
 * client that edits its own copy. `send` applies the client's change to the
 * replica and validates it the way `applyClientUpdate` does.
 */
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
    const touched = collectTouchedItems(transaction!, documentItems(replica));
    return validateTouchedItems(
      touched,
      documentItems(accepted),
      documentItems(replica),
    );
  }

  return { client, send };
}

function item(doc: Y.Doc, id: string): Y.Map<unknown> {
  return documentItems(doc).get(id) as Y.Map<unknown>;
}

describe("collaborative update validation", () => {
  it("reports a valid creation with its validated state", () => {
    const { send } = setup([]);
    const id = createCanvasItemId();
    const changes = send((doc) =>
      doc.transact(() => applyItemState(documentItems(doc), id, shape(id))),
    );
    expect(changes).toEqual([{ kind: "create", state: shape(id) }]);
  });

  it("reports only the fields an update changed", () => {
    const id = createCanvasItemId();
    const { send } = setup([shape(id)]);
    const changes = send((doc) => {
      item(doc, id).set("positionX", 25);
      item(doc, id).set("tags", ["idea"]);
    });
    expect(changes).toEqual([
      {
        kind: "update",
        id,
        type: ItemType.SHAPE,
        fields: { positionX: 25, tags: ["idea"] },
        replaced: false,
      },
    ]);
  });

  it("turns a note text edit into note content", () => {
    const id = createCanvasItemId();
    const { send } = setup([note(id, "Hello")]);
    const changes = send((doc) => {
      const paragraph = (item(doc, id).get("text") as Y.XmlFragment).get(
        0,
      ) as Y.XmlElement;
      (paragraph.get(0) as Y.XmlText).insert(5, " there");
    });
    expect(changes).toHaveLength(1);
    expect(changes[0]).toMatchObject({
      kind: "update",
      id,
      fields: { content: { plainText: "Hello there" } },
    });
  });

  it("reports a removed item as a deletion", () => {
    const id = createCanvasItemId();
    const { send } = setup([shape(id)]);
    expect(send((doc) => documentItems(doc).delete(id))).toEqual([
      { kind: "delete", id },
    ]);
  });

  it("validates a replaced item map as a whole", () => {
    const id = createCanvasItemId();
    const { send } = setup([shape(id)]);
    const changes = send((doc) =>
      doc.transact(() => {
        documentItems(doc).delete(id);
        applyItemState(documentItems(doc), id, shape(id, { width: 90 }));
      }),
    );
    expect(changes).toEqual([
      {
        kind: "update",
        id,
        type: ItemType.SHAPE,
        fields: {
          positionX: 0,
          positionY: 0,
          width: 90,
          height: 40,
          zIndex: 1,
          tags: [],
          content: { shapeType: "rectangle" },
        },
        replaced: true,
      },
    ]);
  });

  it.each([
    [
      "invalid geometry",
      (doc: Y.Doc, id: string) => item(doc, id).set("width", -1),
    ],
    [
      "an unknown field",
      (doc: Y.Doc, id: string) => item(doc, id).set("owner", "me"),
    ],
    [
      "a type change",
      (doc: Y.Doc, id: string) => item(doc, id).set("type", "TEXT"),
    ],
    [
      "a removed field",
      (doc: Y.Doc, id: string) => item(doc, id).delete("height"),
    ],
    [
      "content the schema would change",
      (doc: Y.Doc, id: string) =>
        item(doc, id).set("content", { shapeType: "circle", extra: true }),
    ],
    [
      "rich text on a non-note",
      (doc: Y.Doc, id: string) =>
        item(doc, id).set("text", new Y.XmlFragment()),
    ],
    [
      "a nested type outside note text",
      (doc: Y.Doc, id: string) => item(doc, id).set("tags", new Y.Array()),
    ],
    [
      "a change outside the item map",
      (doc: Y.Doc) => doc.getMap("settings").set("theme", "dark"),
    ],
    [
      "a non-map item",
      (doc: Y.Doc) =>
        documentItems(doc).set(createCanvasItemId(), "x" as never),
    ],
    [
      "an item id that is not a cuid",
      (doc: Y.Doc) =>
        doc.transact(() =>
          applyItemState(documentItems(doc), "not-an-id", shape("not-an-id")),
        ),
    ],
  ])("refuses %s", (_label, edit) => {
    const id = createCanvasItemId();
    const { send } = setup([shape(id)]);
    expect(() => send((doc) => edit(doc, id))).toThrow(
      InvalidDocumentUpdateError,
    );
  });

  it("refuses unsafe note text", () => {
    const id = createCanvasItemId();
    const { send } = setup([note(id, "Hello")]);
    expect(() =>
      send((doc) => {
        const fragment = item(doc, id).get("text") as Y.XmlFragment;
        fragment.insert(0, [new Y.XmlElement("script")]);
      }),
    ).toThrow(InvalidDocumentUpdateError);
  });
});
