/**
 * BookmarkItem Konva Component
 *
 * Renders a bookmark on the canvas with:
 * - URL display
 * - Drag to move
 * - Resize handles
 * - Delete button
 * - Autosave on changes
 *
 * Following ADR-0009: Autosave with debouncing
 *
 * Performance: Memoized to prevent unnecessary re-renders when sibling items change
 */

'use client';

import React, { useRef, useState, useEffect, memo } from 'react';
import { Group, Rect, Text, Circle } from 'react-konva';
import Konva from 'konva';
import { CanvasItem, BookmarkContent, isBookmarkContent } from '@/types/canvas';
import { useAutosave } from '@/lib/hooks/use-autosave';
import { useDeleteCanvasItem } from '@/lib/hooks/use-canvas-items';

interface BookmarkItemProps {
  item: CanvasItem;
  isSelected?: boolean;
  onSelect?: () => void;
  onDeselect?: () => void;
}

const RESIZE_HANDLE_SIZE = 8;
const MIN_WIDTH = 200;
const MIN_HEIGHT = 80;
const DELETE_BUTTON_SIZE = 20;

function BookmarkItemComponent({
  item,
  isSelected = false,
  onSelect,
  onDeselect,
}: BookmarkItemProps) {
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

  const deleteItem = useDeleteCanvasItem();

  // Extract bookmark content
  const content = isBookmarkContent(item.content) ? item.content : { url: 'Invalid bookmark' };

  // Sync with server updates
  useEffect(() => {
    setLocalPosition({ x: item.positionX, y: item.positionY });
    setLocalSize({ width: item.width, height: item.height });
  }, [item.positionX, item.positionY, item.width, item.height]);

  // Handle drag
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

  // Handle resize
  const handleResize = (
    corner: 'se' | 'sw' | 'ne' | 'nw',
    e: Konva.KonvaEventObject<MouseEvent>
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
      case 'se': // Bottom-right
        newWidth = Math.max(MIN_WIDTH, pointerPos.x - localPosition.x);
        newHeight = Math.max(MIN_HEIGHT, pointerPos.y - localPosition.y);
        break;
      case 'sw': // Bottom-left
        newWidth = Math.max(MIN_WIDTH, localPosition.x + localSize.width - pointerPos.x);
        newHeight = Math.max(MIN_HEIGHT, pointerPos.y - localPosition.y);
        newX = localPosition.x + localSize.width - newWidth;
        break;
      case 'ne': // Top-right
        newWidth = Math.max(MIN_WIDTH, pointerPos.x - localPosition.x);
        newHeight = Math.max(MIN_HEIGHT, localPosition.y + localSize.height - pointerPos.y);
        newY = localPosition.y + localSize.height - newHeight;
        break;
      case 'nw': // Top-left
        newWidth = Math.max(MIN_WIDTH, localPosition.x + localSize.width - pointerPos.x);
        newHeight = Math.max(MIN_HEIGHT, localPosition.y + localSize.height - pointerPos.y);
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

  // Handle delete
  const handleDelete = () => {
    if (confirm('Delete this bookmark?')) {
      deleteItem.mutate({ itemId: item.id, version: item.version });
    }
  };

  // Truncate URL for display
  const displayUrl = content.url.length > 50 ? content.url.substring(0, 47) + '...' : content.url;

  return (
    <Group
      ref={groupRef}
      x={localPosition.x}
      y={localPosition.y}
      draggable
      onDragMove={handleDragMove}
      onDragEnd={handleDragEnd}
      onClick={onSelect}
      onTap={onSelect}
    >
      {/* Main bookmark rectangle */}
      <Rect
        width={localSize.width}
        height={localSize.height}
        fill="#FFF9E6"
        stroke={isSelected ? '#2196F3' : '#FFB74D'}
        strokeWidth={isSelected ? 3 : 2}
        shadowColor="black"
        shadowBlur={5}
        shadowOpacity={0.2}
        shadowOffset={{ x: 2, y: 2 }}
        cornerRadius={8}
      />

      {/* Bookmark icon/indicator */}
      <Rect x={10} y={10} width={30} height={30} fill="#FFB74D" cornerRadius={4} />

      {/* URL text */}
      <Text
        x={50}
        y={15}
        width={localSize.width - 60}
        text={displayUrl}
        fontSize={14}
        fontFamily="Arial"
        fill="#1976D2"
        textDecoration="underline"
        wrap="none"
        ellipsis={true}
      />

      {/* "Bookmark" label */}
      <Text
        x={10}
        y={localSize.height - 30}
        width={localSize.width - 20}
        text="Bookmark"
        fontSize={11}
        fontFamily="Arial"
        fill="#666"
      />

      {/* Saving indicator */}
      {isSaving && (
        <Text
          x={localSize.width - 80}
          y={localSize.height - 30}
          text="Saving..."
          fontSize={10}
          fill="#999"
        />
      )}

      {/* Resize handles (only when selected) */}
      {isSelected && (
        <>
          {/* Bottom-right */}
          <Circle
            x={localSize.width}
            y={localSize.height}
            radius={RESIZE_HANDLE_SIZE}
            fill="#2196F3"
            draggable
            onDragMove={(e) => handleResize('se', e)}
            onDragEnd={handleResizeEnd}
            onMouseEnter={(e) => {
              const stage = e.target.getStage();
              if (stage) stage.container().style.cursor = 'nwse-resize';
            }}
            onMouseLeave={(e) => {
              const stage = e.target.getStage();
              if (stage) stage.container().style.cursor = 'default';
            }}
          />

          {/* Bottom-left */}
          <Circle
            x={0}
            y={localSize.height}
            radius={RESIZE_HANDLE_SIZE}
            fill="#2196F3"
            draggable
            onDragMove={(e) => handleResize('sw', e)}
            onDragEnd={handleResizeEnd}
            onMouseEnter={(e) => {
              const stage = e.target.getStage();
              if (stage) stage.container().style.cursor = 'nesw-resize';
            }}
            onMouseLeave={(e) => {
              const stage = e.target.getStage();
              if (stage) stage.container().style.cursor = 'default';
            }}
          />

          {/* Top-right */}
          <Circle
            x={localSize.width}
            y={0}
            radius={RESIZE_HANDLE_SIZE}
            fill="#2196F3"
            draggable
            onDragMove={(e) => handleResize('ne', e)}
            onDragEnd={handleResizeEnd}
            onMouseEnter={(e) => {
              const stage = e.target.getStage();
              if (stage) stage.container().style.cursor = 'nesw-resize';
            }}
            onMouseLeave={(e) => {
              const stage = e.target.getStage();
              if (stage) stage.container().style.cursor = 'default';
            }}
          />

          {/* Top-left */}
          <Circle
            x={0}
            y={0}
            radius={RESIZE_HANDLE_SIZE}
            fill="#2196F3"
            draggable
            onDragMove={(e) => handleResize('nw', e)}
            onDragEnd={handleResizeEnd}
            onMouseEnter={(e) => {
              const stage = e.target.getStage();
              if (stage) stage.container().style.cursor = 'nwse-resize';
            }}
            onMouseLeave={(e) => {
              const stage = e.target.getStage();
              if (stage) stage.container().style.cursor = 'default';
            }}
          />

          {/* Delete button */}
          <Circle
            x={localSize.width - DELETE_BUTTON_SIZE}
            y={DELETE_BUTTON_SIZE}
            radius={DELETE_BUTTON_SIZE}
            fill="#F44336"
            onClick={handleDelete}
            onTap={handleDelete}
            onMouseEnter={(e) => {
              const stage = e.target.getStage();
              if (stage) stage.container().style.cursor = 'pointer';
            }}
            onMouseLeave={(e) => {
              const stage = e.target.getStage();
              if (stage) stage.container().style.cursor = 'default';
            }}
          />
          <Text
            x={localSize.width - DELETE_BUTTON_SIZE - 5}
            y={DELETE_BUTTON_SIZE - 6}
            text="×"
            fontSize={20}
            fill="white"
            listening={false}
          />
        </>
      )}
    </Group>
  );
}

/**
 * Memoized BookmarkItem with custom comparison
 * Only re-renders if item data, selection state, or handlers change
 */
export const BookmarkItem = memo(BookmarkItemComponent, (prevProps, nextProps) => {
  // Re-render if selection state changes
  if (prevProps.isSelected !== nextProps.isSelected) {
    return false;
  }

  // Re-render if handlers change
  if (prevProps.onSelect !== nextProps.onSelect || prevProps.onDeselect !== nextProps.onDeselect) {
    return false;
  }

  // Re-render if item data changes
  const prevItem = prevProps.item;
  const nextItem = nextProps.item;

  if (
    prevItem.id !== nextItem.id ||
    prevItem.version !== nextItem.version ||
    prevItem.positionX !== nextItem.positionX ||
    prevItem.positionY !== nextItem.positionY ||
    prevItem.width !== nextItem.width ||
    prevItem.height !== nextItem.height ||
    JSON.stringify(prevItem.content) !== JSON.stringify(nextItem.content)
  ) {
    return false;
  }

  // Props are equal, skip re-render
  return true;
});
