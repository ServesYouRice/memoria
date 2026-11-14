"use client";

import React, { useEffect, useState } from "react";
import {
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Stack,
  TextField,
} from "@mui/material";
import { toast } from "sonner";
import { isTableContent, type CanvasItem } from "@/types/canvas";
import { useTableEditor } from "@/features/canvas/lib/table-editor-store";
import { useUpdateCanvasItem } from "@/lib/hooks/use-canvas-items";
import {
  TABLE_MAX_CELL_CHARS,
  TABLE_MAX_COLUMNS,
  TABLE_MAX_ROWS,
  addTableColumn,
  addTableRow,
  removeTableColumn,
  removeTableRow,
  setTableCell,
  tableCellKey,
  tableHeight,
  tableWidth,
  type TableContent,
} from "@/lib/tables/table-content";

/**
 * IMP-108: edits one table cell, and adds or removes the cell's row or
 * column. Each save writes the table as it is now with only this change,
 * so cells other people are editing stay as they are.
 */
export function TableCellDialog({ items }: { items: CanvasItem[] }) {
  const cell = useTableEditor((state) => state.cell);
  const close = useTableEditor((state) => state.close);
  const updateItem = useUpdateCanvasItem();
  const item = cell ? items.find((entry) => entry.id === cell.itemId) : null;
  const table = item && isTableContent(item.content) ? item.content : null;
  const rowIndex = table?.rows.findIndex((row) => row.id === cell?.rowId) ?? -1;
  const columnIndex =
    table?.columns.findIndex((column) => column.id === cell?.columnId) ?? -1;
  const current =
    table && cell
      ? (table.cells[tableCellKey(cell.rowId, cell.columnId)] ?? "")
      : "";
  const [value, setValue] = useState(current);

  const open = Boolean(table && cell && rowIndex >= 0 && columnIndex >= 0);
  useEffect(() => {
    if (open) setValue(current);
    // Only when another cell is opened, not while typing.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, cell?.itemId, cell?.rowId, cell?.columnId]);
  useEffect(() => {
    // The table or the cell was removed (by someone else, too).
    if (cell && !open) close();
  }, [cell, open, close]);

  if (!open || !item || !table || !cell) return null;

  const save = (next: (latest: TableContent) => TableContent) => {
    const content = next(table);
    updateItem.mutate(
      {
        itemId: item.id,
        data: {
          version: item.version,
          content,
          width: tableWidth(content),
          height: tableHeight(content),
        },
      },
      {
        onError: (error) =>
          toast.error(
            error instanceof Error ? error.message : "The table was not saved.",
          ),
      },
    );
    close();
  };

  const withCell = (latest: TableContent) =>
    value === current
      ? latest
      : setTableCell(latest, cell.rowId, cell.columnId, value);

  return (
    <Dialog open onClose={close} maxWidth="xs" fullWidth>
      <DialogTitle>
        Row {rowIndex + 1}, column {columnIndex + 1}
      </DialogTitle>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          save(withCell);
        }}
      >
        <DialogContent>
          <TextField
            label="Cell"
            value={value}
            onChange={(event) =>
              setValue(event.target.value.slice(0, TABLE_MAX_CELL_CHARS))
            }
            slotProps={{ htmlInput: { maxLength: TABLE_MAX_CELL_CHARS } }}
            helperText={`${value.length}/${TABLE_MAX_CELL_CHARS}`}
            autoFocus
            fullWidth
          />
          <Stack direction="row" spacing={1} sx={{ mt: 2, flexWrap: "wrap" }}>
            <Button
              size="small"
              disabled={table.rows.length >= TABLE_MAX_ROWS}
              onClick={() =>
                save((latest) => addTableRow(withCell(latest), cell.rowId))
              }
            >
              Add row below
            </Button>
            <Button
              size="small"
              disabled={table.columns.length >= TABLE_MAX_COLUMNS}
              onClick={() =>
                save((latest) =>
                  addTableColumn(withCell(latest), cell.columnId),
                )
              }
            >
              Add column right
            </Button>
            <Button
              size="small"
              color="error"
              disabled={table.rows.length <= 1}
              onClick={() =>
                save((latest) => removeTableRow(latest, cell.rowId))
              }
            >
              Delete row
            </Button>
            <Button
              size="small"
              color="error"
              disabled={table.columns.length <= 1}
              onClick={() =>
                save((latest) => removeTableColumn(latest, cell.columnId))
              }
            >
              Delete column
            </Button>
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={close}>Cancel</Button>
          <Button type="submit" variant="contained">
            Save
          </Button>
        </DialogActions>
      </form>
    </Dialog>
  );
}
