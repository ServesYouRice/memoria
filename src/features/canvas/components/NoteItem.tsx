/**
 * NoteItem Konva Component
 *
 * Minimal Note component for reference
 * (Full implementation would be part of Slice 4)
 */

"use client";

import React, { useRef, useState, useEffect } from "react";
import { Group, Rect, Text, Circle } from "react-konva";
import type Konva from "konva";
import {
  cornerHandlePosition,
  resizeFromCorner,
  type ResizeCorner,
} from "@/features/canvas/lib/geometry-adapter";
import { isNoteContent, type CanvasItemAdapterProps } from "@/types/canvas";
import { stripHtmlTags } from "@/lib/utils/html";
import { normalizeNoteContent } from "@/lib/rich-text/note-format";
import { useThemeMode } from "@/lib/theme-context";
import { NOTE_COLORS } from "@/features/canvas/lib/note-colors";
import { useCanvasPalette } from "@/features/canvas/lib/canvas-palette";

type NoteItemProps = CanvasItemAdapterProps;

const RESIZE_HANDLE_SIZE = 8;
const MIN_WIDTH = 150;
const MIN_HEIGHT = 100;

export function NoteItem({
  item,
  isSelected = false,
  capabilities,
  onSelect,
  onActivate,
  onContextMenu,
  onCommitGeometry,
}: NoteItemProps) {
  const palette = useCanvasPalette();
  const groupRef = useRef<Konva.Group>(null);
  const noteColors = NOTE_COLORS[useThemeMode().mode];
  const [localPosition, setLocalPosition] = useState({
    x: item.positionX,
    y: item.positionY,
  });
  const [localSize, setLocalSize] = useState({
    width: item.width,
    height: item.height,
  });

  const content = isNoteContent(item.content) ? item.content : null;
  let readableText = "Invalid note";
  if (content) {
    try {
      // Co-edited notes may be empty for a while (IMP-042).
      readableText = normalizeNoteContent(content, {
        allowEmpty: true,
      }).plainText;
    } catch {
      readableText = stripHtmlTags(content.text || "Unsupported note content");
    }
  }

  useEffect(() => {
    setLocalPosition({ x: item.positionX, y: item.positionY });
    setLocalSize({ width: item.width, height: item.height });
  }, [item.positionX, item.positionY, item.width, item.height]);

  const handleDragMove = (e: Konva.KonvaEventObject<DragEvent>) => {
    // Only the item body moves the item; a resize handle's drag is its own.
    if (e.target !== e.currentTarget) return;
    const node = e.target;
    const newPos = {
      x: node.x(),
      y: node.y(),
    };
    setLocalPosition(newPos);
  };

  const handleDragEnd = (e: Konva.KonvaEventObject<DragEvent>) => {
    if (e.target !== e.currentTarget) return;
    const node = e.target;
    onCommitGeometry({ positionX: node.x(), positionY: node.y() });
  };

  const handleResize = (
    corner: ResizeCorner,
    e: Konva.KonvaEventObject<DragEvent>,
  ) => {
    // The handle's drag must not bubble into the Group's move handlers.
    e.cancelBubble = true;
    const stage = e.target.getStage();
    if (!stage) return;

    // Item geometry is in world space; the Stage is zoomed and panned.
    const pointerPos = stage.getRelativePointerPosition();
    if (!pointerPos) return;

    const next = resizeFromCorner(
      corner,
      pointerPos,
      localPosition,
      localSize,
      {
        width: MIN_WIDTH,
        height: MIN_HEIGHT,
      },
    );
    setLocalSize({ width: next.width, height: next.height });
    setLocalPosition({ x: next.x, y: next.y });
  };

  const handleResizeEnd = (
    corner: ResizeCorner,
    e: Konva.KonvaEventObject<DragEvent>,
  ) => {
    e.cancelBubble = true;
    // Put the dragged handle back on its corner of the new size.
    e.target.position(cornerHandlePosition(corner, localSize));
    onCommitGeometry({
      positionX: localPosition.x,
      positionY: localPosition.y,
      width: localSize.width,
      height: localSize.height,
    });
  };

  return (
    <Group
      ref={groupRef}
      x={localPosition.x}
      y={localPosition.y}
      draggable={capabilities.canMoveItems}
      onDragMove={handleDragMove}
      onDragEnd={handleDragEnd}
      onClick={onSelect}
      onTap={onSelect}
      onDblClick={onActivate}
      onDblTap={onActivate}
      onContextMenu={onContextMenu}
    >
      <Rect
        width={localSize.width}
        height={localSize.height}
        fill={noteColors.fill}
        stroke={isSelected ? palette.selection : noteColors.stroke}
        strokeWidth={isSelected ? 3 : 2}
        shadowColor="black"
        shadowBlur={5}
        shadowOpacity={0.2}
        shadowOffset={{ x: 2, y: 2 }}
        cornerRadius={4}
      />

      <Text
        x={10}
        y={10}
        width={localSize.width - 20}
        height={localSize.height - 20}
        text={readableText}
        fontSize={14}
        fontFamily="Arial"
        fill={noteColors.text}
        wrap="word"
      />

      {isSelected && capabilities.canResizeItems && (
        <>
          {/* Resize handles */}
          <Circle
            x={localSize.width}
            y={localSize.height}
            radius={RESIZE_HANDLE_SIZE}
            fill={palette.selection}
            draggable
            onDragMove={(e) => handleResize("se", e)}
            onDragEnd={(e) => handleResizeEnd("se", e)}
            onMouseEnter={(e) => {
              const stage = e.target.getStage();
              if (stage) stage.container().style.cursor = "nwse-resize";
            }}
            onMouseLeave={(e) => {
              const stage = e.target.getStage();
              if (stage) stage.container().style.cursor = "default";
            }}
          />

          <Circle
            x={0}
            y={localSize.height}
            radius={RESIZE_HANDLE_SIZE}
            fill={palette.selection}
            draggable
            onDragMove={(e) => handleResize("sw", e)}
            onDragEnd={(e) => handleResizeEnd("sw", e)}
            onMouseEnter={(e) => {
              const stage = e.target.getStage();
              if (stage) stage.container().style.cursor = "nesw-resize";
            }}
            onMouseLeave={(e) => {
              const stage = e.target.getStage();
              if (stage) stage.container().style.cursor = "default";
            }}
          />

          <Circle
            x={localSize.width}
            y={0}
            radius={RESIZE_HANDLE_SIZE}
            fill={palette.selection}
            draggable
            onDragMove={(e) => handleResize("ne", e)}
            onDragEnd={(e) => handleResizeEnd("ne", e)}
            onMouseEnter={(e) => {
              const stage = e.target.getStage();
              if (stage) stage.container().style.cursor = "nesw-resize";
            }}
            onMouseLeave={(e) => {
              const stage = e.target.getStage();
              if (stage) stage.container().style.cursor = "default";
            }}
          />

          <Circle
            x={0}
            y={0}
            radius={RESIZE_HANDLE_SIZE}
            fill={palette.selection}
            draggable
            onDragMove={(e) => handleResize("nw", e)}
            onDragEnd={(e) => handleResizeEnd("nw", e)}
            onMouseEnter={(e) => {
              const stage = e.target.getStage();
              if (stage) stage.container().style.cursor = "nwse-resize";
            }}
            onMouseLeave={(e) => {
              const stage = e.target.getStage();
              if (stage) stage.container().style.cursor = "default";
            }}
          />
        </>
      )}
    </Group>
  );
}
