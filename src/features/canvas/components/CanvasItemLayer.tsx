import React from "react";
import { Group, Layer } from "react-konva";
import type {
  CanvasCapabilities,
  CanvasItem,
  ItemGeometryCommit,
} from "@/types/canvas";
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
} from "@/types/canvas";
import { SelectionBox } from "@/features/canvas/components/SelectionBox";
import type { SelectionBox as SelectionBoxState } from "@/lib/hooks/use-selection-box";

import { BookmarkItem } from "@/features/canvas/components/BookmarkItem";
import { NoteItem } from "@/features/canvas/components/NoteItem";
import { ImageItem } from "@/features/canvas/components/ImageItem";
import { DrawingItem } from "@/features/canvas/components/DrawingItem";
import { ShapeItem } from "@/features/canvas/components/ShapeItem";
import { ArrowItem } from "@/features/canvas/components/ArrowItem";
import { TextItem } from "@/features/canvas/components/TextItem";
import { FrameItem } from "@/features/canvas/components/FrameItem";
import { EmbedItem } from "@/features/canvas/components/EmbedItem";
import { PollItem } from "@/features/canvas/components/PollItem";
import { isStructuralCanvasItem } from "@/features/canvas/search";

interface CanvasItemLayerProps {
  items: CanvasItem[];
  selectedItemIds: Set<string>;
  isSelecting: boolean;
  selectionBox: SelectionBoxState | null;
  /** One capability contract, applied identically to every item type. */
  capabilities: CanvasCapabilities;
  onSelectItem: (id: string) => void;
  onContextMenu: (event: any, itemId: string) => void;
  /** Double-click / Enter activation; the parent decides what may be edited. */
  onActivateItem: (item: CanvasItem) => void;
  /** The single durable geometry write path (IMP-008). */
  onCommitGeometry: (item: CanvasItem, geometry: ItemGeometryCommit) => void;
  searchActive?: boolean;
  searchMatchIds?: ReadonlySet<string>;
}

/**
 * Renders every item type through the same adapter contract: capabilities in,
 * one geometry commit out. No item component owns its own durable write.
 */
export function CanvasItemLayer({
  items,
  selectedItemIds,
  isSelecting,
  selectionBox,
  capabilities,
  onSelectItem,
  onContextMenu,
  onActivateItem,
  onCommitGeometry,
  searchActive = false,
  searchMatchIds,
}: CanvasItemLayerProps) {
  return (
    <Layer>
      {items.map((item) => {
        const adapterProps = {
          item,
          isSelected: selectedItemIds.has(item.id),
          capabilities,
          onSelect: () => onSelectItem(item.id),
          onContextMenu: (event: any) => onContextMenu(event, item.id),
          onActivate: () => onActivateItem(item),
          onCommitGeometry: (geometry: ItemGeometryCommit) =>
            onCommitGeometry(item, geometry),
        };

        let rendered: React.ReactNode = null;
        if (item.type === ItemType.NOTE && isNoteContent(item.content)) {
          rendered = <NoteItem {...adapterProps} />;
        }
        if (item.type === ItemType.BOOKMARK) {
          rendered = <BookmarkItem {...adapterProps} />;
        }
        if (item.type === ItemType.IMAGE) {
          rendered = <ImageItem {...adapterProps} />;
        }
        if (item.type === ItemType.DRAWING && isDrawingContent(item.content)) {
          rendered = <DrawingItem {...adapterProps} />;
        }
        if (item.type === ItemType.SHAPE && isShapeContent(item.content)) {
          rendered = <ShapeItem {...adapterProps} />;
        }
        if (item.type === ItemType.ARROW && isArrowContent(item.content)) {
          rendered = <ArrowItem {...adapterProps} />;
        }
        if (item.type === ItemType.TEXT && isTextContent(item.content)) {
          rendered = <TextItem {...adapterProps} />;
        }
        if (item.type === ItemType.FRAME && isFrameContent(item.content)) {
          rendered = <FrameItem {...adapterProps} />;
        }
        if (item.type === ItemType.EMBED && isEmbedContent(item.content)) {
          rendered = <EmbedItem {...adapterProps} />;
        }
        if (item.type === ItemType.POLL && isPollContent(item.content)) {
          rendered = <PollItem {...adapterProps} />;
        }
        if (!rendered) return null;

        const isMatch = searchMatchIds?.has(item.id) ?? true;
        const opacity =
          !searchActive || isMatch || selectedItemIds.has(item.id)
            ? 1
            : isStructuralCanvasItem(item)
              ? 0.55
              : 0.18;
        return (
          <Group key={item.id} opacity={opacity}>
            {rendered}
          </Group>
        );
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
