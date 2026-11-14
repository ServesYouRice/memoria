/**
 * IMP-108: which table cell is open for editing. The canvas draws with
 * Konva, which cannot hold a text box, so a table item asks this store to
 * open the cell and the board shows the editor as a normal dialog.
 */
import { create } from "zustand";

export interface OpenTableCell {
  itemId: string;
  rowId: string;
  columnId: string;
}

interface TableEditorState {
  cell: OpenTableCell | null;
  open: (cell: OpenTableCell) => void;
  close: () => void;
}

export const useTableEditor = create<TableEditorState>((set) => ({
  cell: null,
  open: (cell) => set({ cell }),
  close: () => set({ cell: null }),
}));
