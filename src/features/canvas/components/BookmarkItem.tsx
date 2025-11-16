/**
 * BookmarkItem Konva Component
 *
 * OPTIMIZED: Issue #30 - Canvas performance improvements
 *
 * Renders a bookmark on the canvas with:
 * - URL display
 * - Drag to move
 * - Resize handles
 * - Delete button
 * - Autosave on changes
 *
 * Uses React.memo to prevent unnecessary re-renders.
 * Following ADR-0009: Autosave with debouncing
 */

'use client';

import React, { useRef, useState, useEffect } from 'react';
import { Group, Rect, Text, Circle, Image as KonvaImage } from 'react-konva';
import Konva from 'konva';
import { CanvasItem, BookmarkContent, isBookmarkContent } from '@/types/canvas';
import { useAutosave } from '@/lib/hooks/use-autosave';
import { useDeleteCanvasItem } from '@/lib/hooks/use-canvas-items';

interface BookmarkItemProps {
  item: CanvasItem;
  isSelected?: boolean;
  onSelect?: () => void;
  onDeselect?: () => void;
  onDoubleClick?: () => void;
  onContextMenu?: (e: any) => void;
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
  onDoubleClick,
  onContextMenu,
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
  const [favicon, setFavicon] = useState<HTMLImageElement | null>(null);

  const { saveChanges, isSaving } = useAutosave({
    itemId: item.id,
    version: item.version,
    debounceMs: 500,
  });

  const deleteItem = useDeleteCanvasItem();

  // Extract bookmark content
  const content = isBookmarkContent(item.content) ? item.content : { url: 'Invalid bookmark' };

  // Check if we have metadata
  const hasMetadata = content.title || content.description;

  // Sync with server updates
  useEffect(() => {
    setLocalPosition({ x: item.positionX, y: item.positionY });
    setLocalSize({ width: item.width, height: item.height });
  }, [item.positionX, item.positionY, item.width, item.height]);

  // Load favicon if available
  useEffect(() => {
    if (content.favicon) {
      const img = new window.Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => {
        setFavicon(img);
      };
      img.onerror = () => {
        console.error('Failed to load favicon:', content.favicon);
      };
      img.src = content.favicon;
    } else {
      setFavicon(null);
    }
  }, [content.favicon]);

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
      onDblClick={onDoubleClick}
      onDblTap={onDoubleClick}
      onContextMenu={onContextMenu}
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

      {/* Content area with metadata */}
      {hasMetadata ? (
        <>
          {/* Favicon */}
          {favicon && (
            <KonvaImage
              image={favicon}
              x={10}
              y={10}
              width={20}
              height={20}
            />
          )}

          {/* Title */}
          {content.title && (
            <Text
              x={favicon ? 38 : 10}
              y={10}
              width={localSize.width - (favicon ? 48 : 20)}
              text={content.title}
              fontSize={15}
              fontWeight="bold"
              fontFamily="Arial"
              fill="#333"
              wrap="none"
              ellipsis={true}
            />
          )}

          {/* Description */}
          {content.description && (
            <Text
              x={10}
              y={35}
              width={localSize.width - 20}
              height={localSize.height - 65}
              text={content.description}
              fontSize={12}
              fontFamily="Arial"
              fill="#666"
              wrap="word"
            />
          )}

          {/* Site name or URL */}
          <Text
            x={10}
            y={localSize.height - 25}
            width={localSize.width - 20}
            text={content.siteName || displayUrl}
            fontSize={10}
            fontFamily="Arial"
            fill="#999"
            wrap="none"
            ellipsis={true}
          />
        </>
      ) : (
        <>
          {/* Bookmark icon/indicator (fallback when no metadata) */}
          <Rect x={10} y={10} width={30} height={30} fill="#FFB74D" cornerRadius={4} />

          {/* URL text (fallback when no metadata) */}
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
        </>
      )}

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
 *
 * Same optimization strategy as NoteItem:
 * - Prevents re-renders when other canvas items change
 * - Only re-renders when the item itself is updated
 * - Or when selection state changes
 */
export const BookmarkItem = React.memo(BookmarkItemComponent, (prevProps, nextProps) => {
  // Re-render if item changed
  if (prevProps.item.id !== nextProps.item.id) {
    return false;
  }

  // Re-render if selection state changed
  if (prevProps.isSelected !== nextProps.isSelected) {
    return false;
  }

  // Re-render if item was updated
  if (prevProps.item.updatedAt !== nextProps.item.updatedAt) {
    return false;
  }

  // Re-render if version changed
  if (prevProps.item.version !== nextProps.item.version) {
    return false;
  }

  // No changes detected, skip re-render
  return true;
});
