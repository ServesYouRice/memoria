/**
 * IMP-108: a simple table on the canvas. Client-safe.
 *
 * Stored content (row and HTTP form):
 *   { columns: [{id, width}], rows: [{id, height}], cells: {"row:col": text},
 *     text }
 * Cells hold plain text keyed by stable row and column ids, so a cell keeps
 * its place when rows or columns are added or removed. `text` is derived
 * from the cells on every write (never trusted from the client); search,
 * Ask and agents read it like any other item text.
 *
 * In the collaborative document the structure is one value and each cell is
 * its own entry, so two people editing different cells never lose either
 * change (see `sync/document-items.ts`).
 */
import { z } from "zod";

export const TABLE_MAX_ROWS = 40;
export const TABLE_MAX_COLUMNS = 10;
export const TABLE_MAX_CELL_CHARS = 200;
export const TABLE_MIN_COLUMN_WIDTH = 40;
export const TABLE_MAX_COLUMN_WIDTH = 600;
export const TABLE_MIN_ROW_HEIGHT = 24;
export const TABLE_MAX_ROW_HEIGHT = 300;
export const TABLE_DEFAULT_COLUMN_WIDTH = 120;
export const TABLE_DEFAULT_ROW_HEIGHT = 36;

const TABLE_ID = /^[a-z0-9]{1,16}$/;

export interface TableColumn {
  id: string;
  width: number;
}
export interface TableRow {
  id: string;
  height: number;
}
export interface TableContent {
  columns: TableColumn[];
  rows: TableRow[];
  cells: Record<string, string>;
  /** Every cell's text, row by row; derived, for search and agents. */
  text: string;
}
/** What the collaborative document keeps as one value. */
export type TableStructure = Pick<TableContent, "columns" | "rows">;

export function tableCellKey(rowId: string, columnId: string): string {
  return `${rowId}:${columnId}`;
}

/** A cell key's ids, or null when it is not one. */
export function parseTableCellKey(
  key: string,
): { rowId: string; columnId: string } | null {
  const [rowId, columnId, extra] = key.split(":");
  if (extra !== undefined || !rowId || !columnId) return null;
  if (!TABLE_ID.test(rowId) || !TABLE_ID.test(columnId)) return null;
  return { rowId, columnId };
}

/** Plain text without control characters (tabs and newlines become spaces). */
export function cleanCellText(value: string): string {
  return value
    .replace(/[\u0000-\u001f\u007f]+/g, " ")
    .slice(0, TABLE_MAX_CELL_CHARS);
}

const idSchema = z.string().regex(TABLE_ID);
const columnSchema = z.object({
  id: idSchema,
  width: z
    .number()
    .finite()
    .min(TABLE_MIN_COLUMN_WIDTH)
    .max(TABLE_MAX_COLUMN_WIDTH)
    .transform(Math.round),
});
const rowSchema = z.object({
  id: idSchema,
  height: z
    .number()
    .finite()
    .min(TABLE_MIN_ROW_HEIGHT)
    .max(TABLE_MAX_ROW_HEIGHT)
    .transform(Math.round),
});

function uniqueIds(list: Array<{ id: string }>): boolean {
  return new Set(list.map((entry) => entry.id)).size === list.length;
}

export const tableStructureSchema = z.object({
  columns: z
    .array(columnSchema)
    .min(1)
    .max(TABLE_MAX_COLUMNS)
    .refine(uniqueIds, "Each column needs its own id"),
  rows: z
    .array(rowSchema)
    .min(1)
    .max(TABLE_MAX_ROWS)
    .refine(uniqueIds, "Each row needs its own id"),
});

/**
 * The stored form: cells of removed rows or columns and empty cells are
 * dropped, and `text` is rebuilt from the cells.
 */
export const tableContentSchema = tableStructureSchema
  .extend({
    cells: z
      .record(z.string(), z.string().max(TABLE_MAX_CELL_CHARS))
      .default({}),
    text: z.string().optional(),
  })
  .strict()
  .transform((value) => normalizeTable(value));

/** Keep only live, non-empty, clean cells, in table order, and the text. */
export function normalizeTable(input: {
  columns: TableColumn[];
  rows: TableRow[];
  cells?: Record<string, string>;
}): TableContent {
  const cells: Record<string, string> = {};
  const source = input.cells ?? {};
  for (const row of input.rows) {
    for (const column of input.columns) {
      const key = tableCellKey(row.id, column.id);
      const value = source[key];
      if (typeof value !== "string") continue;
      const clean = cleanCellText(value);
      if (clean.trim()) cells[key] = clean;
    }
  }
  const columns = input.columns.map(({ id, width }) => ({ id, width }));
  const rows = input.rows.map(({ id, height }) => ({ id, height }));
  return { columns, rows, cells, text: tableText({ columns, rows, cells }) };
}

/** Every cell's text: cells joined by " | ", rows by new lines. */
export function tableText(
  table: Pick<TableContent, "columns" | "rows" | "cells">,
): string {
  return table.rows
    .map((row) =>
      table.columns
        .map((column) => table.cells[tableCellKey(row.id, column.id)] ?? "")
        .join(" | ")
        .trim(),
    )
    .filter((line) => line.replace(/[|\s]/g, ""))
    .join("\n");
}

export function tableWidth(table: Pick<TableContent, "columns">): number {
  return table.columns.reduce((sum, column) => sum + column.width, 0);
}

export function tableHeight(table: Pick<TableContent, "rows">): number {
  return table.rows.reduce((sum, row) => sum + row.height, 0);
}

export function isTableContentShape(value: unknown): value is TableContent {
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  return (
    Array.isArray(record.columns) &&
    Array.isArray(record.rows) &&
    !!record.cells &&
    typeof record.cells === "object"
  );
}

export function newTableId(): string {
  const bytes = new Uint8Array(8);
  globalThis.crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => (byte % 36).toString(36)).join("");
}

/** A fresh `rows` × `columns` table with default sizes. */
export function createTable(rows = 3, columns = 3): TableContent {
  return normalizeTable({
    columns: Array.from({ length: columns }, () => ({
      id: newTableId(),
      width: TABLE_DEFAULT_COLUMN_WIDTH,
    })),
    rows: Array.from({ length: rows }, () => ({
      id: newTableId(),
      height: TABLE_DEFAULT_ROW_HEIGHT,
    })),
    cells: {},
  });
}

export function setTableCell(
  table: TableContent,
  rowId: string,
  columnId: string,
  value: string,
): TableContent {
  return normalizeTable({
    ...table,
    cells: { ...table.cells, [tableCellKey(rowId, columnId)]: value },
  });
}

/** A new row after `afterRowId` (or at the end). */
export function addTableRow(
  table: TableContent,
  afterRowId?: string,
): TableContent {
  if (table.rows.length >= TABLE_MAX_ROWS) return table;
  const row = { id: newTableId(), height: TABLE_DEFAULT_ROW_HEIGHT };
  const index = afterRowId
    ? table.rows.findIndex((entry) => entry.id === afterRowId) + 1
    : table.rows.length;
  const rows = [...table.rows];
  rows.splice(index <= 0 ? table.rows.length : index, 0, row);
  return normalizeTable({ ...table, rows });
}

/** A new column after `afterColumnId` (or at the end). */
export function addTableColumn(
  table: TableContent,
  afterColumnId?: string,
): TableContent {
  if (table.columns.length >= TABLE_MAX_COLUMNS) return table;
  const column = { id: newTableId(), width: TABLE_DEFAULT_COLUMN_WIDTH };
  const index = afterColumnId
    ? table.columns.findIndex((entry) => entry.id === afterColumnId) + 1
    : table.columns.length;
  const columns = [...table.columns];
  columns.splice(index <= 0 ? table.columns.length : index, 0, column);
  return normalizeTable({ ...table, columns });
}

export function removeTableRow(
  table: TableContent,
  rowId: string,
): TableContent {
  if (table.rows.length <= 1) return table;
  return normalizeTable({
    ...table,
    rows: table.rows.filter((row) => row.id !== rowId),
  });
}

export function removeTableColumn(
  table: TableContent,
  columnId: string,
): TableContent {
  if (table.columns.length <= 1) return table;
  return normalizeTable({
    ...table,
    columns: table.columns.filter((column) => column.id !== columnId),
  });
}

export function resizeTableColumn(
  table: TableContent,
  columnId: string,
  width: number,
): TableContent {
  const clamped = Math.round(
    Math.min(TABLE_MAX_COLUMN_WIDTH, Math.max(TABLE_MIN_COLUMN_WIDTH, width)),
  );
  return normalizeTable({
    ...table,
    columns: table.columns.map((column) =>
      column.id === columnId ? { ...column, width: clamped } : column,
    ),
  });
}

export function resizeTableRow(
  table: TableContent,
  rowId: string,
  height: number,
): TableContent {
  const clamped = Math.round(
    Math.min(TABLE_MAX_ROW_HEIGHT, Math.max(TABLE_MIN_ROW_HEIGHT, height)),
  );
  return normalizeTable({
    ...table,
    rows: table.rows.map((row) =>
      row.id === rowId ? { ...row, height: clamped } : row,
    ),
  });
}

function markdownCell(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/\|/g, "\\|").trim() || " ";
}

/** A Markdown table; the first row is the header row. */
export function tableToMarkdown(table: TableContent): string {
  const line = (row: TableRow) =>
    `| ${table.columns
      .map((column) =>
        markdownCell(table.cells[tableCellKey(row.id, column.id)] ?? ""),
      )
      .join(" | ")} |`;
  const [header, ...body] = table.rows;
  if (!header) return "";
  return [
    line(header),
    `| ${table.columns.map(() => "---").join(" | ")} |`,
    ...body.map(line),
  ].join("\n");
}
