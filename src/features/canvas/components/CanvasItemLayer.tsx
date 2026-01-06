import React from 'react';
import { Layer } from 'react-konva';
import type { CanvasItem } from '@/types/canvas';
import {
  ItemType,
  isNoteContent,
  isDrawingContent,
  isShapeContent,
  isArrowContent,
  isTextContent,
  isFrameContent,
  isEmbedContent,
  isPollContent,
} from '@/types/canvas';
import { SelectionBox } from '@/features/canvas/components/SelectionBox';
import type { SelectionBox as SelectionBoxState } from '@/lib/hooks/use-selection-box';

import { BookmarkItem } from '@/features/canvas/components/BookmarkItem';
import { NoteItem } from '@/features/canvas/components/NoteItem';
import { ImageItem } from '@/features/canvas/components/ImageItem';
import { DrawingItem } from '@/features/canvas/components/DrawingItem';
import { ShapeItem } from '@/features/canvas/components/ShapeItem';
import { ArrowItem } from '@/features/canvas/components/ArrowItem';
import { TextItem } from '@/features/canvas/components/TextItem';
import { FrameItem } from '@/features/canvas/components/FrameItem';
import { EmbedItem } from '@/features/canvas/components/EmbedItem';
import { PollItem } from '@/features/canvas/components/PollItem';

interface CanvasItemLayerProps {
  items: CanvasItem[];
  selectedItemIds: Set<string>;
  isSelecting: boolean;
  selectionBox: SelectionBoxState | null;
  onSelectItem: (id: string) => void;
  onContextMenu: (event: any, itemId: string) => void;
  onNoteDoubleClick: (item: CanvasItem) => void;
  onBookmarkDoubleClick: (item: CanvasItem) => void;
  onImageDoubleClick: (item: CanvasItem) => void;
  onDragEnd: (event: any, item: CanvasItem) => void;
  onItemChange: (id: string, data: any) => void;
}

export function CanvasItemLayer({
  items,
  selectedItemIds,
  isSelecting,
  selectionBox,
  onSelectItem,
  onContextMenu,
  onNoteDoubleClick,
  onBookmarkDoubleClick,
  onImageDoubleClick,
  onDragEnd,
  onItemChange,
}: CanvasItemLayerProps) {
  return (
    <Layer>
      {items.map((item) => {
        const isSelected = selectedItemIds.has(item.id);
        if (item.type === ItemType.NOTE && isNoteContent(item.content)) {
          return (
            <NoteItem
              key={item.id}
              item={item}
              isSelected={isSelected}
              onSelect={() => onSelectItem(item.id)}
              onContextMenu={(event: any) => onContextMenu(event, item.id)}
              onDoubleClick={() => onNoteDoubleClick(item)}
              onDragEnd={(event: any) => onDragEnd(event, item)}
            />
          );
        }
        if (item.type === ItemType.BOOKMARK) {
          return (
            <BookmarkItem
              key={item.id}
              item={item}
              isSelected={isSelected}
              onSelect={() => onSelectItem(item.id)}
              onContextMenu={(event: any) => onContextMenu(event, item.id)}
              onDoubleClick={() => onBookmarkDoubleClick(item)}
              onDragEnd={(event: any) => onDragEnd(event, item)}
            />
          );
        }
        if (item.type === ItemType.IMAGE) {
          return (
            <ImageItem
              key={item.id}
              item={item}
              isSelected={isSelected}
              onSelect={() => onSelectItem(item.id)}
              onContextMenu={(event: any) => onContextMenu(event, item.id)}
              onDoubleClick={() => onImageDoubleClick(item)}
              onDragEnd={(event: any) => onDragEnd(event, item)}
            />
          );
        }
        if (item.type === ItemType.DRAWING && isDrawingContent(item.content)) {
          return (
            <DrawingItem
              key={item.id}
              item={item}
              isSelected={isSelected}
              onSelect={() => onSelectItem(item.id)}
              onContextMenu={(event: any) => onContextMenu(event, item.id)}
            />
          );
        }
        if (item.type === ItemType.SHAPE && isShapeContent(item.content)) {
          return (
            <ShapeItem
              key={item.id}
              item={item}
              isSelected={isSelected}
              onSelect={() => onSelectItem(item.id)}
              onContextMenu={(event: any) => onContextMenu(event, item.id)}
            />
          );
        }
        if (item.type === ItemType.ARROW && isArrowContent(item.content)) {
          return (
            <ArrowItem
              key={item.id}
              item={item}
              isSelected={isSelected}
              onSelect={() => onSelectItem(item.id)}
              onContextMenu={(event: any) => onContextMenu(event, item.id)}
            />
          );
        }
        if (item.type === ItemType.TEXT && isTextContent(item.content)) {
          return (
            <TextItem
              key={item.id}
              item={item}
              isSelected={isSelected}
              onSelect={() => onSelectItem(item.id)}
              onContextMenu={(event: any) => onContextMenu(event, item.id)}
              onChange={(data: any) => onItemChange(item.id, data)}
              onDoubleClick={() => onNoteDoubleClick(item)}
            />
          );
        }
        if (item.type === ItemType.FRAME && isFrameContent(item.content)) {
          return (
            <FrameItem
              key={item.id}
              item={item}
              isSelected={isSelected}
              onSelect={() => onSelectItem(item.id)}
              onContextMenu={(event: any) => onContextMenu(event, item.id)}
            />
          );
        }
        if (item.type === ItemType.EMBED && isEmbedContent(item.content)) {
          return (
            <EmbedItem
              key={item.id}
              item={item}
              isSelected={isSelected}
              onSelect={() => onSelectItem(item.id)}
              onContextMenu={(event: any) => onContextMenu(event, item.id)}
            />
          );
        }
        if (item.type === ItemType.POLL && isPollContent(item.content)) {
          return (
            <PollItem
              key={item.id}
              item={item}
              isSelected={isSelected}
              onSelect={() => onSelectItem(item.id)}
              onContextMenu={(event: any) => onContextMenu(event, item.id)}
            />
          );
        }
        return null;
      })}

      {isSelecting && selectionBox && (
        <SelectionBox
          x={selectionBox.x}
          y={selectionBox.y}
          width={selectionBox.width}
          height={selectionBox.height}
        />
      )}
    </Layer>
  );
}
