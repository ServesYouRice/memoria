import React from "react";
import type Konva from "konva";
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
  isArrowItemContent,
  isTextItemContent,
  isFrameItemContent,
  isEmbedContent,
  isPollContent,
  isTableContent,
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
import { TableItem } from "@/features/canvas/components/TableItem";
import { isStructuralCanvasItem } from "@/features/canvas/search";
import { createPressAndHold } from "@/features/canvas/press-and-hold";

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
  /** Every item on the canvas (not just the visible ones), so arrows follow. */
  allItems?: readonly CanvasItem[];
  /** An arrow end was dropped at a canvas point (IMP-095). */
  onMoveArrowEnd?: (
    arrow: CanvasItem,
    which: "start" | "end",
    point: { x: number; y: number },
  ) => void;
}

/**
 * Renders every item type through the same adapter contract: capabilities in,
 * one geometry commit out. No item component owns its own durable write.
 */
/**
 * Memoized (IMP-103): a pan or zoom changes only the Stage transform, so the
 * items are not re-rendered unless their own inputs change.
 */
export const CanvasItemLayer = React.memo(function CanvasItemLayer({
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
  allItems,
  onMoveArrowEnd,
}: CanvasItemLayerProps) {
  const itemsById = React.useMemo(
    () => new Map((allItems ?? items).map((item) => [item.id, item])),
    [allItems, items],
  );

  // IMP-140: iOS Safari sends no `contextmenu` for a long press, so a held
  // finger opens the same item menu that right-click opens.
  const layerRef = React.useRef<Konva.Layer>(null);
  const onContextMenuRef = React.useRef(onContextMenu);
  onContextMenuRef.current = onContextMenu;
  const hold = React.useMemo(
    () =>
      createPressAndHold<string>({
        onHold: (point, itemId) =>
          onContextMenuRef.current(
            {
              evt: {
                clientX: point.x,
                clientY: point.y,
                preventDefault: () => {},
              },
            },
            itemId,
          ),
      }),
    [],
  );
  React.useEffect(() => {
    const container = layerRef.current?.getStage()?.container();
    if (!container) return;
    // A second finger (pinch), movement or lifting ends the hold. These are
    // stage-wide because the second finger may land off the item.
    const onStart = (event: TouchEvent) => {
      if (event.touches.length > 1) hold.cancel();
    };
    const onMove = (event: TouchEvent) => {
      const touch = event.touches[0];
      if (touch) hold.move({ x: touch.clientX, y: touch.clientY });
    };
    const onEnd = () => hold.cancel();
    container.style.setProperty("-webkit-touch-callout", "none");
    container.addEventListener("touchstart", onStart, { passive: true });
    container.addEventListener("touchmove", onMove, { passive: true });
    container.addEventListener("touchend", onEnd, { passive: true });
    container.addEventListener("touchcancel", onEnd, { passive: true });
    return () => {
      hold.cancel();
      container.removeEventListener("touchstart", onStart);
      container.removeEventListener("touchmove", onMove);
      container.removeEventListener("touchend", onEnd);
      container.removeEventListener("touchcancel", onEnd);
    };
  }, [hold]);

  return (
    <Layer ref={layerRef}>
      {items.map((item) => {
        const adapterProps = {
          item,
          isSelected: selectedItemIds.has(item.id),
          capabilities,
          onSelect: () => onSelectItem(item.id),
          onContextMenu: (event: any) => {
            // Android sends `contextmenu` after the same long press.
            if (hold.shouldIgnoreContextMenu()) {
              event?.evt?.preventDefault?.();
              return;
            }
            onContextMenu(event, item.id);
          },
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
        if (item.type === ItemType.ARROW && isArrowItemContent(item.content)) {
          rendered = (
            <ArrowItem
              {...adapterProps}
              itemsById={itemsById}
              onMoveEnd={
                onMoveArrowEnd
                  ? (which, point) => onMoveArrowEnd(item, which, point)
                  : undefined
              }
            />
          );
        }
        if (item.type === ItemType.TEXT && isTextItemContent(item.content)) {
          rendered = <TextItem {...adapterProps} />;
        }
        if (item.type === ItemType.FRAME && isFrameItemContent(item.content)) {
          rendered = <FrameItem {...adapterProps} />;
        }
        if (item.type === ItemType.EMBED && isEmbedContent(item.content)) {
          rendered = <EmbedItem {...adapterProps} />;
        }
        if (item.type === ItemType.POLL && isPollContent(item.content)) {
          rendered = <PollItem {...adapterProps} />;
        }
        if (item.type === ItemType.TABLE && isTableContent(item.content)) {
          rendered = <TableItem {...adapterProps} />;
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
          <Group
            key={item.id}
            opacity={opacity}
            onTouchStart={(event) => {
              const touch = event.evt.touches[0];
              if (touch) {
                hold.start(
                  { x: touch.clientX, y: touch.clientY },
                  item.id,
                  event.evt.touches.length,
                );
              }
            }}
            onDragStart={(event) => {
              // A drag is not a hold; and a hold that already opened the
              // menu must not turn into a drag of the item.
              if (hold.isHeld()) event.target.stopDrag();
              else hold.cancel();
            }}
          >
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
});
