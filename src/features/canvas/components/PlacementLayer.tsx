"use client";

import React from "react";
import { Group, Layer, Rect, Text } from "react-konva";
import type { KonvaEventObject } from "konva/lib/Node";
import type { CanvasItem } from "@/types/canvas";
import { placedAsCanvasItem, type PlacedItem } from "@/lib/placements/shared";
import { ReadonlyCanvasItem } from "@/features/canvas/components/ReadonlyCanvasItemLayer";
import { useCanvasPalette } from "@/features/canvas/lib/canvas-palette";

const NO_ITEMS: ReadonlyMap<string, CanvasItem> = new Map();

export function placementLabel(placed: PlacedItem): string {
  return placed.homeCanvasName
    ? `Also on ${placed.homeCanvasName}`
    : "Shown from another canvas";
}

interface PlacementLayerProps {
  canvasId: string;
  placed: PlacedItem[];
  canMove: boolean;
  onMove: (placementId: string, x: number, y: number) => void;
  /** Right-click or double-click: offer "Open original" and "Remove". */
  onMenu: (placed: PlacedItem, clientX: number, clientY: number) => void;
}

/**
 * IMP-109: items from other canvases shown on this one. They are read-only
 * here and marked with where they come from; people who may edit this canvas
 * can move them. Edits happen on the home canvas ("Open original").
 */
export function PlacementLayer({
  canvasId,
  placed,
  canMove,
  onMove,
  onMenu,
}: PlacementLayerProps) {
  const palette = useCanvasPalette();
  if (placed.length === 0) return null;

  const openMenu = (
    entry: PlacedItem,
    event: KonvaEventObject<MouseEvent | TouchEvent | PointerEvent>,
  ) => {
    event.cancelBubble = true;
    event.evt.preventDefault();
    const native = event.evt as MouseEvent;
    const pointer =
      typeof native.clientX === "number"
        ? { x: native.clientX, y: native.clientY }
        : (event.target.getStage()?.getPointerPosition() ?? { x: 0, y: 0 });
    onMenu(entry, pointer.x, pointer.y);
  };

  return (
    <Layer>
      {placed.map((entry) => {
        const item = placedAsCanvasItem(entry, canvasId);
        return (
          <Group
            key={entry.placementId}
            name="placed-item"
            id={`placement-${entry.placementId}`}
            draggable={canMove}
            onDragEnd={(event) => {
              const group = event.target;
              const x = item.positionX + group.x();
              const y = item.positionY + group.y();
              group.position({ x: 0, y: 0 });
              onMove(entry.placementId, x, y);
            }}
            onContextMenu={(event) => openMenu(entry, event)}
            onDblClick={(event) => openMenu(entry, event)}
            onDblTap={(event) => openMenu(entry, event)}
          >
            <ReadonlyCanvasItem item={item} itemsById={NO_ITEMS} />
            <Rect
              x={item.positionX - 3}
              y={item.positionY - 3}
              width={item.width + 6}
              height={item.height + 6}
              stroke={palette.selection}
              strokeWidth={1}
              dash={[6, 4]}
              cornerRadius={6}
              listening={false}
            />
            <Text
              x={item.positionX}
              y={item.positionY - 18}
              width={Math.max(item.width, 160)}
              text={`↗ ${placementLabel(entry)}`}
              fontSize={11}
              fill={palette.textMuted}
              ellipsis
              wrap="none"
              listening={false}
            />
          </Group>
        );
      })}
    </Layer>
  );
}
