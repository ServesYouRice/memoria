/**
 * NoteItem Konva Component
 *
 * OPTIMIZED: Issue #30 - Canvas performance improvements
 *
 * Uses React.memo to prevent unnecessary re-renders when:
 * - Other items on the canvas change
 * - Parent component re-renders
 * - Unrelated props update
 *
 * Only re-renders when:
 * - Item's updatedAt timestamp changes
 * - Selection state changes
 * - Item version changes (for conflict resolution)
 */

'use client';

import React, { useRef, useState, useEffect } from 'react';
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
 *
 * Comparison logic:
 * - item.id: Must match (different items are different)
 * - item.updatedAt: Changes mean content/position updated
 * - item.version: Changes mean conflict resolution needed
 * - isSelected: Changes affect rendering (highlight, delete button)
 *
 * This prevents re-renders when:
 * - Parent canvas re-renders
 * - Other items in the array change
 * - Unrelated state updates
 */
export const NoteItem = React.memo(NoteItemComponent, (prevProps, nextProps) => {
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

  // Re-render if version changed (conflict resolution)
  if (prevProps.item.version !== nextProps.item.version) {
    return false;
  }

  // No changes detected, skip re-render
  return true;
});
