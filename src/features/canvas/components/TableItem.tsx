"use client";

import React from "react";
import { Group, Line, Rect, Text } from "react-konva";
import { toast } from "sonner";
import { isTableContent, type CanvasItemAdapterProps } from "@/types/canvas";
import { commitGroupDragEnd } from "@/features/canvas/lib/geometry-adapter";
import { useCanvasPalette } from "@/features/canvas/lib/canvas-palette";
import { useTableEditor } from "@/features/canvas/lib/table-editor-store";
import { useUpdateCanvasItem } from "@/lib/hooks/use-canvas-items";
import {
  TABLE_MAX_COLUMN_WIDTH,
  TABLE_MAX_ROW_HEIGHT,
  TABLE_MIN_COLUMN_WIDTH,
  TABLE_MIN_ROW_HEIGHT,
  resizeTableColumn,
  resizeTableRow,
  tableCellKey,
  tableHeight,
  tableWidth,
  type TableContent,
} from "@/lib/tables/table-content";

const CELL_PADDING = 8;
const HANDLE = 8;

/**
 * IMP-108: a simple table. Double-click a cell to edit it (and to add or
 * remove rows and columns); when the table is selected, drag a column's
 * right edge or a row's bottom edge to resize it. The first row is drawn as
 * the header.
 */
export function TableItem({
  item,
  isSelected,
  capabilities,
  onSelect,
  onContextMenu,
  onCommitGeometry,
}: CanvasItemAdapterProps) {
  const palette = useCanvasPalette();
  const openCell = useTableEditor((state) => state.open);
  const updateItem = useUpdateCanvasItem();
  if (!isTableContent(item.content)) return null;
  const table = item.content;
  const width = tableWidth(table);
  const height = tableHeight(table);
  const canEdit = capabilities.canEditItems;

  const save = (next: TableContent) => {
    updateItem.mutate(
      {
        itemId: item.id,
        data: {
          version: item.version,
          content: next,
          width: tableWidth(next),
          height: tableHeight(next),
        },
      },
      {
        onError: (error) =>
          toast.error(
            error instanceof Error ? error.message : "The table was not saved.",
          ),
      },
    );
  };

  const columnX: number[] = [];
  table.columns.reduce((x, column) => {
    columnX.push(x);
    return x + column.width;
  }, 0);
  const rowY: number[] = [];
  table.rows.reduce((y, row) => {
    rowY.push(y);
    return y + row.height;
  }, 0);

  return (
    <Group
      id={item.id}
      x={item.positionX}
      y={item.positionY}
      width={width}
      height={height}
      draggable={isSelected && capabilities.canMoveItems}
      onDragEnd={(e) => {
        // Resize handles end their own drags; only the table moves here.
        if (e.target.id() !== item.id) return;
        commitGroupDragEnd(e, onCommitGeometry);
      }}
      onClick={(e) => {
        e.cancelBubble = true;
        onSelect();
      }}
      onTap={(e) => {
        e.cancelBubble = true;
        onSelect();
      }}
      onContextMenu={onContextMenu}
    >
      <Rect
        width={width}
        height={height}
        fill={palette.surface}
        stroke={isSelected ? palette.selection : palette.borderStrong}
        strokeWidth={isSelected ? 2 : 1}
        cornerRadius={4}
      />
      {table.rows.map((row, rowIndex) =>
        table.columns.map((column, columnIndex) => {
          const value = table.cells[tableCellKey(row.id, column.id)] ?? "";
          const edit = () => {
            if (!canEdit) return;
            openCell({ itemId: item.id, rowId: row.id, columnId: column.id });
          };
          return (
            <Group
              key={`${row.id}:${column.id}`}
              name="table-cell"
              x={columnX[columnIndex]}
              y={rowY[rowIndex]}
              onDblClick={edit}
              onDblTap={edit}
            >
              <Rect
                width={column.width}
                height={row.height}
                fill={rowIndex === 0 ? palette.surfaceSubtle : palette.surface}
                stroke={palette.border}
                strokeWidth={1}
              />
              <Text
                x={CELL_PADDING}
                y={CELL_PADDING}
                width={Math.max(0, column.width - CELL_PADDING * 2)}
                height={Math.max(0, row.height - CELL_PADDING * 2)}
                text={value}
                fontSize={14}
                fontStyle={rowIndex === 0 ? "bold" : "normal"}
                fill={palette.text}
                verticalAlign="middle"
                wrap="word"
                ellipsis
              />
            </Group>
          );
        }),
      )}
      {isSelected &&
        canEdit &&
        table.columns.map((column, index) => {
          const right = columnX[index]! + column.width;
          return (
            <Line
              key={`col-${column.id}`}
              name="table-column-handle"
              points={[0, 0, 0, height]}
              x={right}
              y={0}
              stroke={palette.selection}
              strokeWidth={2}
              hitStrokeWidth={HANDLE}
              opacity={0.4}
              draggable
              dragBoundFunc={function (
                this: { absolutePosition: () => { x: number; y: number } },
                pos,
              ) {
                return { x: pos.x, y: this.absolutePosition().y };
              }}
              onMouseEnter={(e) => {
                const container = e.target.getStage()?.container();
                if (container) container.style.cursor = "col-resize";
              }}
              onMouseLeave={(e) => {
                const container = e.target.getStage()?.container();
                if (container) container.style.cursor = "";
              }}
              onDragEnd={(e) => {
                e.cancelBubble = true;
                const next = Math.min(
                  TABLE_MAX_COLUMN_WIDTH,
                  Math.max(
                    TABLE_MIN_COLUMN_WIDTH,
                    e.target.x() - columnX[index]!,
                  ),
                );
                e.target.x(right);
                save(resizeTableColumn(table, column.id, next));
              }}
            />
          );
        })}
      {isSelected &&
        canEdit &&
        table.rows.map((row, index) => {
          const bottom = rowY[index]! + row.height;
          return (
            <Line
              key={`row-${row.id}`}
              name="table-row-handle"
              points={[0, 0, width, 0]}
              x={0}
              y={bottom}
              stroke={palette.selection}
              strokeWidth={2}
              hitStrokeWidth={HANDLE}
              opacity={0.4}
              draggable
              dragBoundFunc={function (
                this: { absolutePosition: () => { x: number; y: number } },
                pos,
              ) {
                return { x: this.absolutePosition().x, y: pos.y };
              }}
              onMouseEnter={(e) => {
                const container = e.target.getStage()?.container();
                if (container) container.style.cursor = "row-resize";
              }}
              onMouseLeave={(e) => {
                const container = e.target.getStage()?.container();
                if (container) container.style.cursor = "";
              }}
              onDragEnd={(e) => {
                e.cancelBubble = true;
                const next = Math.min(
                  TABLE_MAX_ROW_HEIGHT,
                  Math.max(TABLE_MIN_ROW_HEIGHT, e.target.y() - rowY[index]!),
                );
                e.target.y(bottom);
                save(resizeTableRow(table, row.id, next));
              }}
            />
          );
        })}
    </Group>
  );
}
