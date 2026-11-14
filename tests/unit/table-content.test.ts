/**
 * IMP-108: tables on the canvas. The content rules, the Markdown copy, and
 * two people editing different cells of one table at the same moment.
 */
import { describe, expect, it } from "vitest";
import * as Y from "yjs";
import { ItemType } from "@/types/canvas";
import { canvasItemContentSchemas } from "@/lib/validation/canvas-item";
import {
  TABLE_MAX_CELL_CHARS,
  TABLE_MAX_COLUMNS,
  TABLE_MAX_ROWS,
  addTableColumn,
  addTableRow,
  createTable,
  normalizeTable,
  removeTableColumn,
  removeTableRow,
  resizeTableColumn,
  setTableCell,
  tableCellKey,
  tableContentSchema,
  tableToMarkdown,
  tableWidth,
  type TableContent,
} from "@/lib/tables/table-content";
import {
  applyItemState,
  createCanvasYDoc,
  createDocumentFromRows,
  documentItems,
  readItemState,
  tableCellsMap,
  type CanvasItemState,
} from "@/lib/collaboration/sync/document-items";
import {
  InvalidDocumentUpdateError,
  collectTouchedItems,
  validateTouchedItems,
} from "@/lib/collaboration/sync/validation";
import { createCanvasItemId } from "@/lib/collaboration/sync/protocol";

function filled(): TableContent {
  let table = createTable(2, 2);
  const [r1, r2] = table.rows;
  const [c1, c2] = table.columns;
  table = setTableCell(table, r1!.id, c1!.id, "Name");
  table = setTableCell(table, r1!.id, c2!.id, "Owner");
  table = setTableCell(table, r2!.id, c1!.id, "Launch");
  return setTableCell(table, r2!.id, c2!.id, "Ana | Bo");
}

describe("table content (IMP-108)", () => {
  it("keeps the words as plain text for search and Ask", () => {
    expect(filled().text).toBe("Name | Owner\nLaunch | Ana | Bo");
  });

  it("drops empty and orphan cells and cleans control characters", () => {
    const table = filled();
    const normalized = normalizeTable({
      ...table,
      cells: {
        ...table.cells,
        [tableCellKey("zzz", table.columns[0]!.id)]: "orphan",
        [tableCellKey(table.rows[0]!.id, table.columns[0]!.id)]: "Na\u0007me",
        [tableCellKey(table.rows[1]!.id, table.columns[1]!.id)]: "",
      },
    });
    expect(Object.values(normalized.cells)).toEqual([
      "Na me",
      "Owner",
      "Launch",
    ]);
  });

  it("is checked by the item content schema and enforces the limits", () => {
    const schema = canvasItemContentSchemas[ItemType.TABLE];
    expect(schema.safeParse(filled()).success).toBe(true);
    const table = filled();
    const long = {
      ...table,
      cells: {
        [tableCellKey(table.rows[0]!.id, table.columns[0]!.id)]: "x".repeat(
          TABLE_MAX_CELL_CHARS + 1,
        ),
      },
    };
    expect(tableContentSchema.safeParse(long).success).toBe(false);
    expect(
      tableContentSchema.safeParse(createTable(TABLE_MAX_ROWS + 1, 2)).success,
    ).toBe(false);
    expect(
      tableContentSchema.safeParse(createTable(2, TABLE_MAX_COLUMNS + 1))
        .success,
    ).toBe(false);
    expect(
      tableContentSchema.safeParse({ ...table, script: "x" }).success,
    ).toBe(false);
  });

  it("adds, removes and resizes rows and columns", () => {
    let table = filled();
    table = addTableRow(table, table.rows[0]!.id);
    expect(table.rows).toHaveLength(3);
    table = addTableColumn(table, table.columns[0]!.id);
    expect(table.columns).toHaveLength(3);
    // The new empty row stays; the "Launch" row goes. Empty rows add no text.
    table = removeTableRow(table, table.rows[2]!.id);
    expect(table.rows).toHaveLength(2);
    expect(table.text).toBe("Name |  | Owner");
    table = removeTableColumn(table, table.columns[1]!.id);
    table = resizeTableColumn(table, table.columns[0]!.id, 300);
    expect(tableWidth(table)).toBe(300 + table.columns[1]!.width);
  });

  it("copies as a Markdown table with the first row as the header", () => {
    expect(tableToMarkdown(filled())).toBe(
      "| Name | Owner |\n| --- | --- |\n| Launch | Ana \\| Bo |",
    );
  });
});

function tableRow(id: string, content: TableContent): CanvasItemState {
  return {
    id,
    type: ItemType.TABLE,
    positionX: 0,
    positionY: 0,
    width: tableWidth(content),
    height: 72,
    zIndex: 1,
    tags: [],
    content,
  };
}

function send(replica: Y.Doc, accepted: Y.Doc, update: Uint8Array) {
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

describe("tables in the shared document (IMP-108)", () => {
  it("merges two people editing different cells at once", () => {
    const id = createCanvasItemId();
    const table = filled();
    const start = createDocumentFromRows([tableRow(id, table)]);
    const ana = new Y.Doc();
    const bo = new Y.Doc();
    Y.applyUpdate(ana, Y.encodeStateAsUpdate(start));
    Y.applyUpdate(bo, Y.encodeStateAsUpdate(start));

    const [r1, r2] = table.rows;
    const [c1, c2] = table.columns;
    ana.transact(() =>
      applyItemState(
        documentItems(ana),
        id,
        tableRow(id, setTableCell(table, r1!.id, c1!.id, "Task")),
      ),
    );
    bo.transact(() =>
      applyItemState(
        documentItems(bo),
        id,
        tableRow(id, setTableCell(table, r2!.id, c2!.id, "Cy")),
      ),
    );
    Y.applyUpdate(ana, Y.encodeStateAsUpdate(bo));
    Y.applyUpdate(bo, Y.encodeStateAsUpdate(ana));

    for (const doc of [ana, bo]) {
      const state = readItemState(id, documentItems(doc).get(id)!);
      expect((state!.content as TableContent).text).toBe(
        "Task | Owner\nLaunch | Cy",
      );
    }
  });

  it("accepts a cell edit as a content update and rejects bad cells", () => {
    const id = createCanvasItemId();
    const table = filled();
    const accepted = createDocumentFromRows([tableRow(id, table)]);
    const replica = createCanvasYDoc();
    Y.applyUpdate(replica, Y.encodeStateAsUpdate(accepted));
    const client = new Y.Doc();
    Y.applyUpdate(client, Y.encodeStateAsUpdate(accepted));
    const cells = () =>
      tableCellsMap(documentItems(client).get(id) as Y.Map<unknown>)!;
    const key = tableCellKey(table.rows[0]!.id, table.columns[0]!.id);

    let before = Y.encodeStateVector(client);
    cells().set(key, "Task");
    const changes = send(
      replica,
      accepted,
      Y.encodeStateAsUpdate(client, before),
    );
    expect(changes).toHaveLength(1);
    expect(changes[0]).toMatchObject({
      kind: "update",
      id,
      fields: { content: { text: "Task | Owner\nLaunch | Ana | Bo" } },
    });

    const fresh = createCanvasYDoc();
    Y.applyUpdate(fresh, Y.encodeStateAsUpdate(replica));
    before = Y.encodeStateVector(client);
    cells().set(key, "x".repeat(TABLE_MAX_CELL_CHARS + 1));
    expect(() =>
      send(fresh, replica, Y.encodeStateAsUpdate(client, before)),
    ).toThrow(InvalidDocumentUpdateError);
  });
});
