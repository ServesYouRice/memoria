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
import { type CanvasItem, isNoteContent } from "@/types/canvas";
import { useAutosave } from "@/lib/hooks/use-autosave";
import { stripHtmlTags } from "@/lib/utils/html";

interface NoteItemProps {
  item: CanvasItem;
  isSelected?: boolean;
  onSelect?: () => void;
  onDoubleClick?: () => void;
  onContextMenu?: (e: any) => void;
  onDragEnd?: (e: any) => void;
  onChange?: (data: any) => void;
  readOnly?: boolean;
}

const RESIZE_HANDLE_SIZE = 8;
const MIN_WIDTH = 150;
const MIN_HEIGHT = 100;

export function NoteItem({
  item,
  isSelected = false,
  onSelect,
  onDoubleClick,
  onContextMenu,
  readOnly = false,
}: NoteItemProps) {
  const groupRef = useRef<Konva.Group>(null);
  const [localPosition, setLocalPosition] = useState({
    x: item.positionX,
    y: item.positionY,
  });
  const [localSize, setLocalSize] = useState({
    width: item.width,
    height: item.height,
  });

  const { saveChanges, isSaving } = useAutosave({
    itemId: item.id,
    version: item.version,
    debounceMs: 500,
  });

  const content = isNoteContent(item.content)
    ? item.content
    : { text: "Invalid note" };

  useEffect(() => {
    setLocalPosition({ x: item.positionX, y: item.positionY });
    setLocalSize({ width: item.width, height: item.height });
  }, [item.positionX, item.positionY, item.width, item.height]);

  const handleDragMove = (e: Konva.KonvaEventObject<DragEvent>) => {
    const node = e.target;
    const newPos = {
      x: node.x(),
      y: node.y(),
    };
    setLocalPosition(newPos);
  };

  const handleDragEnd = (e: Konva.KonvaEventObject<DragEvent>) => {
    const node = e.target;
    saveChanges({
      positionX: node.x(),
      positionY: node.y(),
    });
  };

  const handleResize = (
    corner: "se" | "sw" | "ne" | "nw",
    e: Konva.KonvaEventObject<MouseEvent>,
  ) => {
    const stage = e.target.getStage();
    if (!stage) return;

    const pointerPos = stage.getPointerPosition();
    if (!pointerPos) return;

    let newWidth = localSize.width;
    let newHeight = localSize.height;
    let newX = localPosition.x;
    let newY = localPosition.y;

    switch (corner) {
      case "se": // Bottom-right
        newWidth = Math.max(MIN_WIDTH, pointerPos.x - localPosition.x);
        newHeight = Math.max(MIN_HEIGHT, pointerPos.y - localPosition.y);
        break;
      case "sw": // Bottom-left
        newWidth = Math.max(
          MIN_WIDTH,
          localPosition.x + localSize.width - pointerPos.x,
        );
        newHeight = Math.max(MIN_HEIGHT, pointerPos.y - localPosition.y);
        newX = localPosition.x + localSize.width - newWidth;
        break;
      case "ne": // Top-right
        newWidth = Math.max(MIN_WIDTH, pointerPos.x - localPosition.x);
        newHeight = Math.max(
          MIN_HEIGHT,
          localPosition.y + localSize.height - pointerPos.y,
        );
        newY = localPosition.y + localSize.height - newHeight;
        break;
      case "nw": // Top-left
        newWidth = Math.max(
          MIN_WIDTH,
          localPosition.x + localSize.width - pointerPos.x,
        );
        newHeight = Math.max(
          MIN_HEIGHT,
          localPosition.y + localSize.height - pointerPos.y,
        );
        newX = localPosition.x + localSize.width - newWidth;
        newY = localPosition.y + localSize.height - newHeight;
        break;
    }

    setLocalSize({ width: newWidth, height: newHeight });
    setLocalPosition({ x: newX, y: newY });
  };

  const handleResizeEnd = () => {
    saveChanges({
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
      draggable={!readOnly}
      onDragMove={handleDragMove}
      onDragEnd={handleDragEnd}
      onClick={onSelect}
      onTap={onSelect}
      onDblClick={onDoubleClick}
      onDblTap={onDoubleClick}
      onContextMenu={onContextMenu}
    >
      <Rect
        width={localSize.width}
        height={localSize.height}
        fill="#FFFACD"
        stroke={isSelected ? "#2196F3" : "#FFD700"}
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
        text={stripHtmlTags(content.text)}
        fontSize={14}
        fontFamily="Arial"
        fill="#333"
        wrap="word"
      />

      {isSaving && (
        <Text
          x={localSize.width - 80}
          y={localSize.height - 25}
          text="Saving..."
          fontSize={10}
          fill="#999"
        />
      )}

      {isSelected && !readOnly && (
        <>
          {/* Resize handles */}
          <Circle
            x={localSize.width}
            y={localSize.height}
            radius={RESIZE_HANDLE_SIZE}
            fill="#2196F3"
            draggable
            onDragMove={(e) => handleResize("se", e)}
            onDragEnd={handleResizeEnd}
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
            fill="#2196F3"
            draggable
            onDragMove={(e) => handleResize("sw", e)}
            onDragEnd={handleResizeEnd}
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
            fill="#2196F3"
            draggable
            onDragMove={(e) => handleResize("ne", e)}
            onDragEnd={handleResizeEnd}
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
            fill="#2196F3"
            draggable
            onDragMove={(e) => handleResize("nw", e)}
            onDragEnd={handleResizeEnd}
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
