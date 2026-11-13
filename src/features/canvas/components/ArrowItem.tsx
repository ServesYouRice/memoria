import React from "react";
import { Group, Arrow, Circle, Label, Tag, Text } from "react-konva";
import type Konva from "konva";
import {
  type ArrowContent,
  type CanvasItem,
  type CanvasItemAdapterProps,
} from "@/types/canvas";
import { commitGroupDragEnd } from "@/features/canvas/lib/geometry-adapter";
import { useCanvasPalette } from "@/features/canvas/lib/canvas-palette";
import { arrowEnds, type Point } from "@/features/canvas/lib/arrow-attachment";

const NO_ITEMS: ReadonlyMap<string, CanvasItem> = new Map();
const DASHES: Record<string, number[] | undefined> = {
  SOLID: undefined,
  DASHED: [10, 6],
  DOTTED: [2, 6],
};

type ArrowItemProps = CanvasItemAdapterProps & {
  /** Every item on the canvas, so attached ends follow their items. */
  itemsById?: ReadonlyMap<string, CanvasItem>;
  /** An end handle was dropped at a canvas point (re-attach or detach). */
  onMoveEnd?: (which: "start" | "end", point: Point) => void;
};

export const ArrowItem: React.FC<ArrowItemProps> = ({
  item,
  isSelected,
  capabilities,
  onSelect,
  onContextMenu,
  onCommitGeometry,
  onActivate,
  itemsById = NO_ITEMS,
  onMoveEnd,
}) => {
  const palette = useCanvasPalette();
  const content = item.content as ArrowContent;
  // Points are relative to the item position, where the Group sits.
  const ends = arrowEnds(item, itemsById);
  const start = {
    x: ends.start.x - item.positionX,
    y: ends.start.y - item.positionY,
  };
  const end = {
    x: ends.end.x - item.positionX,
    y: ends.end.y - item.positionY,
  };
  const points = [start.x, start.y, end.x, end.y];
  const attached = Boolean(content.startItemId || content.endItemId);
  const canEditEnds = isSelected && capabilities.canEditItems && onMoveEnd;
  const stroke = content.stroke || palette.ink;

  const endHandle = (which: "start" | "end", at: Point) => (
    <Circle
      key={which}
      name={`arrow-${which}-handle`}
      x={at.x}
      y={at.y}
      radius={6}
      fill={palette.selection}
      stroke={palette.surface}
      strokeWidth={1.5}
      draggable
      onDragStart={(e) => {
        e.cancelBubble = true;
      }}
      onDragMove={(e) => {
        e.cancelBubble = true;
      }}
      onDragEnd={(e: Konva.KonvaEventObject<DragEvent>) => {
        e.cancelBubble = true;
        const point = {
          x: item.positionX + e.target.x(),
          y: item.positionY + e.target.y(),
        };
        // The handle snaps back; the write redraws the arrow.
        e.target.position(at);
        onMoveEnd?.(which, point);
      }}
    />
  );

  return (
    <Group
      id={item.id}
      x={item.positionX}
      y={item.positionY}
      // An attached arrow follows its items; move its ends to change it.
      draggable={isSelected && capabilities.canMoveItems && !attached}
      onDragEnd={(e) => {
        if (e.target !== e.currentTarget) return;
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
      onDblClick={(e) => {
        e.cancelBubble = true;
        onActivate?.();
      }}
      onDblTap={(e) => {
        e.cancelBubble = true;
        onActivate?.();
      }}
      onContextMenu={onContextMenu}
    >
      <Arrow
        points={points}
        stroke={stroke}
        strokeWidth={content.strokeWidth || 2}
        fill={stroke}
        dash={DASHES[content.lineStyle ?? "SOLID"]}
        pointerLength={content.arrowHeadEnd === "none" ? 0 : 10}
        pointerWidth={content.arrowHeadEnd === "none" ? 0 : 10}
        pointerAtBeginning={content.arrowHeadStart === "arrow"}
        hitStrokeWidth={14}
        opacity={1}
        lineCap="round"
        lineJoin="round"
      />
      {content.label && (
        <Label
          x={(start.x + end.x) / 2}
          y={(start.y + end.y) / 2}
          listening={false}
        >
          <Tag
            fill={palette.surface}
            stroke={palette.border}
            strokeWidth={1}
            cornerRadius={4}
          />
          <Text
            text={content.label}
            fontSize={13}
            padding={4}
            fill={palette.text}
          />
        </Label>
      )}
      {/* Selection highlight */}
      {isSelected && (
        <Arrow
          points={points}
          stroke={palette.selection}
          strokeWidth={1}
          opacity={0.5}
          dash={[5, 5]}
          listening={false}
        />
      )}
      {canEditEnds && endHandle("start", start)}
      {canEditEnds && endHandle("end", end)}
    </Group>
  );
};
