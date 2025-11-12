/**
 * NoteItem Konva Component
 *
 * Minimal Note component for reference
 * (Full implementation would be part of Slice 4)
 *
 * Performance: Memoized to prevent unnecessary re-renders when sibling items change
 */

'use client';

import React, { useRef, useState, useEffect, memo } from 'react';
import { Group, Rect, Text, Circle } from 'react-konva';
import Konva from 'konva';
import { CanvasItem, NoteContent, isNoteContent } from '@/types/canvas';
import { useAutosave } from '@/lib/hooks/use-autosave';
import { useDeleteCanvasItem } from '@/lib/hooks/use-canvas-items';

interface NoteItemProps {
  item: CanvasItem;
  isSelected?: boolean;
  onSelect?: () => void;
}

const DELETE_BUTTON_SIZE = 20;

function NoteItemComponent({ item, isSelected = false, onSelect }: NoteItemProps) {
  const groupRef = useRef<Konva.Group>(null);
  const [localPosition, setLocalPosition] = useState({
    x: item.positionX,
    y: item.positionY,
  });

  const { saveChanges, isSaving } = useAutosave({
    itemId: item.id,
    version: item.version,
    debounceMs: 500,
  });

  const deleteItem = useDeleteCanvasItem();

  const content = isNoteContent(item.content) ? item.content : { text: 'Invalid note' };

  useEffect(() => {
    setLocalPosition({ x: item.positionX, y: item.positionY });
  }, [item.positionX, item.positionY]);

  const handleDragEnd = (e: Konva.KonvaEventObject<DragEvent>) => {
    const node = e.target;
    saveChanges({
      positionX: node.x(),
      positionY: node.y(),
    });
  };

  const handleDelete = () => {
    if (confirm('Delete this note?')) {
      deleteItem.mutate({ itemId: item.id, version: item.version });
    }
  };

  return (
    <Group
      ref={groupRef}
      x={localPosition.x}
      y={localPosition.y}
      draggable
      onDragEnd={handleDragEnd}
      onClick={onSelect}
      onTap={onSelect}
    >
      <Rect
        width={item.width}
        height={item.height}
        fill="#FFFACD"
        stroke={isSelected ? '#2196F3' : '#FFD700'}
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
        width={item.width - 20}
        height={item.height - 20}
        text={content.text}
        fontSize={14}
        fontFamily="Arial"
        fill="#333"
        wrap="word"
      />

      {isSaving && (
        <Text x={item.width - 80} y={item.height - 25} text="Saving..." fontSize={10} fill="#999" />
      )}

      {isSelected && (
        <>
          <Circle
            x={item.width - DELETE_BUTTON_SIZE}
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
            x={item.width - DELETE_BUTTON_SIZE - 5}
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
 * Memoized NoteItem with custom comparison
 * Only re-renders if item data, selection state, or handlers change
 */
export const NoteItem = memo(NoteItemComponent, (prevProps, nextProps) => {
  // Re-render if selection state changes
  if (prevProps.isSelected !== nextProps.isSelected) {
    return false;
  }

  // Re-render if onSelect handler changes
  if (prevProps.onSelect !== nextProps.onSelect) {
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
