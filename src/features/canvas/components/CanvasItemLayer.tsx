import React from "react";
import type Konva from "konva";
import { Group, Layer, Rect } from "react-konva";
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
  isPdfContent,
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
import { PdfItem } from "@/features/canvas/components/PdfItem";
import { isStructuralCanvasItem } from "@/features/canvas/search";
import { createPressAndHold } from "@/features/canvas/press-and-hold";
import {
  useCanvasPalette,
  type CanvasPalette,
} from "@/features/canvas/lib/canvas-palette";
import {
  animateItemSpawn,
  prefersReducedMotion,
  tweenKonvaNode,
} from "@/features/canvas/lib/canvas-motion";

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

interface AnimatedItemGroupProps {
  item: CanvasItem;
  targetOpacity: number;
  isSearchHighlighted: boolean;
  isSearchActiveAndMatch: boolean;
  shouldAnimateSpawn: boolean;
  palette: CanvasPalette;
  onTouchStart: (event: Konva.KonvaEventObject<TouchEvent>) => void;
  onDragStart: (event: Konva.KonvaEventObject<DragEvent>) => void;
  children: React.ReactNode;
}

function AnimatedItemGroup({
  item,
  targetOpacity,
  isSearchHighlighted,
  isSearchActiveAndMatch,
  shouldAnimateSpawn,
  palette,
  onTouchStart,
  onDragStart,
  children,
}: AnimatedItemGroupProps) {
  const groupRef = React.useRef<Konva.Group>(null);
  const spawnTriggeredRef = React.useRef(false);
  const prevOpacityRef = React.useRef(targetOpacity);
  const wasMatchRef = React.useRef(isSearchActiveAndMatch);

  const hasBounds =
    item.type !== ItemType.ARROW && item.width > 0 && item.height > 0;
  const pivotX = hasBounds ? item.positionX + item.width / 2 : 0;
  const pivotY = hasBounds ? item.positionY + item.height / 2 : 0;

  React.useEffect(() => {
    if (!shouldAnimateSpawn || spawnTriggeredRef.current) return;
    spawnTriggeredRef.current = true;
    animateItemSpawn(groupRef.current);
  }, [shouldAnimateSpawn]);

  React.useEffect(() => {
    if (prevOpacityRef.current === targetOpacity) return;
    const prevOpacity = prevOpacityRef.current;
    prevOpacityRef.current = targetOpacity;
    const node = groupRef.current;
    if (!node) return;
    if (
      !prefersReducedMotion() &&
      typeof node.to === "function" &&
      typeof node.setAttrs === "function"
    ) {
      node.setAttrs({ opacity: prevOpacity });
    }
    tweenKonvaNode(node, {
      opacity: targetOpacity,
      duration: 0.18,
    });
  }, [targetOpacity]);

  React.useEffect(() => {
    const wasMatch = wasMatchRef.current;
    wasMatchRef.current = isSearchActiveAndMatch;
    if (!isSearchActiveAndMatch || wasMatch || !hasBounds) return;
    const node = groupRef.current;
    if (!node || prefersReducedMotion() || typeof node.to !== "function") {
      return;
    }
    tweenKonvaNode(node, {
      scaleX: 1.03,
      scaleY: 1.03,
      duration: 0.12,
      onFinish: () => {
        tweenKonvaNode(node, {
          scaleX: 1,
          scaleY: 1,
          duration: 0.18,
        });
      },
    });
  }, [isSearchActiveAndMatch, hasBounds]);

  return (
    <Group
      ref={groupRef}
      x={pivotX}
      y={pivotY}
      offsetX={pivotX}
      offsetY={pivotY}
      opacity={targetOpacity}
      onTouchStart={onTouchStart}
      onDragStart={onDragStart}
    >
      {isSearchHighlighted && hasBounds && (
        <Rect
          x={item.positionX - 4}
          y={item.positionY - 4}
          width={item.width + 8}
          height={item.height + 8}
          cornerRadius={14}
          fill={palette.selectionFill}
          stroke={palette.selection}
          strokeWidth={1.5}
          listening={false}
          perfectDrawEnabled={false}
        />
      )}
      {children}
    </Group>
  );
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
  const palette = useCanvasPalette();
  const sourceItems = allItems ?? items;
  const itemsById = React.useMemo(
    () => new Map(sourceItems.map((item) => [item.id, item])),
    [sourceItems],
  );

  const frameChildCounts = React.useMemo(() => {
    const counts = new Map<string, number>();
    const frames = sourceItems.filter(
      (candidate) => candidate.type === ItemType.FRAME,
    );
    if (frames.length === 0) return counts;
    for (const frame of frames) {
      let count = 0;
      const fx1 = frame.positionX;
      const fy1 = frame.positionY;
      const fx2 = fx1 + frame.width;
      const fy2 = fy1 + frame.height;
      for (const candidate of sourceItems) {
        if (candidate.id === frame.id || candidate.type === ItemType.FRAME) {
          continue;
        }
        const cx = candidate.positionX + candidate.width / 2;
        const cy = candidate.positionY + candidate.height / 2;
        if (cx >= fx1 && cx <= fx2 && cy >= fy1 && cy <= fy2) {
          count += 1;
        }
      }
      counts.set(frame.id, count);
    }
    return counts;
  }, [sourceItems]);

  const hasMountedRef = React.useRef(false);
  const knownIdsRef = React.useRef<Set<string> | null>(null);
  if (knownIdsRef.current === null) {
    knownIdsRef.current = new Set(sourceItems.map((item) => item.id));
  }
  const newlyAddedIds = new Set<string>();
  if (hasMountedRef.current) {
    const unseen = sourceItems.filter(
      (item) => !knownIdsRef.current!.has(item.id),
    );
    // Avoid animating a bulk initial async fetch if the layer mounted empty.
    if (knownIdsRef.current.size > 0 || unseen.length <= 3) {
      for (const item of unseen) {
        newlyAddedIds.add(item.id);
      }
    }
  }
  React.useEffect(() => {
    hasMountedRef.current = true;
    for (const item of sourceItems) {
      knownIdsRef.current!.add(item.id);
    }
  }, [sourceItems]);

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
          rendered = (
            <FrameItem
              {...adapterProps}
              childCount={frameChildCounts.get(item.id)}
            />
          );
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
        if (item.type === ItemType.PDF && isPdfContent(item.content)) {
          rendered = <PdfItem {...adapterProps} />;
        }
        if (!rendered) return null;

        const isMatch = searchMatchIds?.has(item.id) ?? true;
        const isSelected = selectedItemIds.has(item.id);
        const opacity =
          !searchActive || isMatch || isSelected
            ? 1
            : isStructuralCanvasItem(item)
              ? 0.55
              : 0.18;
        return (
          <AnimatedItemGroup
            key={item.id}
            item={item}
            targetOpacity={opacity}
            isSearchHighlighted={searchActive && isMatch && !isSelected}
            isSearchActiveAndMatch={searchActive && isMatch}
            shouldAnimateSpawn={newlyAddedIds.has(item.id)}
            palette={palette}
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
          </AnimatedItemGroup>
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
