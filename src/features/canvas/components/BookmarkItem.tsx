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

"use client";

import React, { useRef, useState, useEffect } from "react";
import { Group, Rect, Text, Circle, Image as KonvaImage } from "react-konva";
import type Konva from "konva";
import { isBookmarkContent, type CanvasItemAdapterProps } from "@/types/canvas";
import { toImageProxyUrl } from "@/lib/images/proxy-url";
import { useCanvasPalette } from "@/features/canvas/lib/canvas-palette";

type BookmarkItemProps = CanvasItemAdapterProps;

const RESIZE_HANDLE_SIZE = 8;
const MIN_WIDTH = 200;
const MIN_HEIGHT = 80;

type ResizeCorner = "se" | "sw" | "ne" | "nw";

/**
 * New geometry for dragging one corner to `pointer`, all in world space; the
 * opposite corner stays put and the size never drops below `min`.
 */
export function resizeFromCorner(
  corner: ResizeCorner,
  pointer: { x: number; y: number },
  position: { x: number; y: number },
  size: { width: number; height: number },
  min: { width: number; height: number },
) {
  const right = position.x + size.width;
  const bottom = position.y + size.height;
  const fromLeft = corner === "sw" || corner === "nw";
  const fromTop = corner === "ne" || corner === "nw";
  const width = Math.max(
    min.width,
    fromLeft ? right - pointer.x : pointer.x - position.x,
  );
  const height = Math.max(
    min.height,
    fromTop ? bottom - pointer.y : pointer.y - position.y,
  );
  return {
    width,
    height,
    x: fromLeft ? right - width : position.x,
    y: fromTop ? bottom - height : position.y,
  };
}

function BookmarkItemComponent({
  item,
  isSelected = false,
  capabilities,
  onSelect,
  onActivate,
  onContextMenu,
  onCommitGeometry,
}: BookmarkItemProps) {
  const palette = useCanvasPalette();
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

  // Extract bookmark content
  const content = isBookmarkContent(item.content)
    ? item.content
    : { url: "Invalid bookmark" };

  // Check if we have metadata
  const hasMetadata = content.title || content.description || content.summary;
  // The enrichment summary says what the link is; a clipped selection or the
  // page description is the fallback.
  const blurb = content.summary || content.description;

  // Sync with server updates
  useEffect(() => {
    setLocalPosition({ x: item.positionX, y: item.positionY });
    setLocalSize({ width: item.width, height: item.height });
  }, [item.positionX, item.positionY, item.width, item.height]);

  // Load favicon if available (remote favicons go through the image proxy)
  useEffect(() => {
    const faviconSrc = toImageProxyUrl(content.favicon);
    if (faviconSrc) {
      const img = new window.Image();
      img.crossOrigin = "anonymous";
      img.onload = () => {
        setFavicon(img);
      };
      img.onerror = () => {
        console.error("Failed to load favicon:", content.favicon);
      };
      img.src = faviconSrc;
    } else {
      setFavicon(null);
    }
  }, [content.favicon]);

  // Handle drag. Only drags of the Group itself move the bookmark; a resize
  // handle's drag events must not reach these handlers.
  const handleDragMove = (e: Konva.KonvaEventObject<DragEvent>) => {
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

  // Handle resize
  const handleResize = (
    corner: ResizeCorner,
    e: Konva.KonvaEventObject<MouseEvent>,
  ) => {
    const stage = e.target.getStage();
    if (!stage) return;

    // Item geometry is in world (layer) space; the Stage is zoomed and
    // panned, so the pointer must be in the same space.
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

  // Resize handles are draggable children of the draggable Group: stop their
  // drag events from bubbling to the Group (and the Stage), so one resize
  // gesture is one geometry write.
  const resizeHandleEvents = (corner: "se" | "sw" | "ne" | "nw") => ({
    onDragMove: (e: Konva.KonvaEventObject<DragEvent>) => {
      e.cancelBubble = true;
      handleResize(corner, e as unknown as Konva.KonvaEventObject<MouseEvent>);
    },
    onDragEnd: (e: Konva.KonvaEventObject<DragEvent>) => {
      e.cancelBubble = true;
      handleResizeEnd();
    },
  });

  const handleResizeEnd = () => {
    onCommitGeometry({
      positionX: localPosition.x,
      positionY: localPosition.y,
      width: localSize.width,
      height: localSize.height,
    });
  };

  // Truncate URL for display
  const displayUrl =
    content.url.length > 50
      ? content.url.substring(0, 47) + "..."
      : content.url;

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
      {/* Main bookmark rectangle */}
      <Rect
        width={localSize.width}
        height={localSize.height}
        fill={palette.bookmark.fill}
        stroke={isSelected ? palette.selection : palette.bookmark.stroke}
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
            <KonvaImage image={favicon} x={10} y={10} width={20} height={20} />
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
              fill={palette.bookmark.text}
              wrap="none"
              ellipsis={true}
            />
          )}

          {/* Description */}
          {blurb && (
            <Text
              x={10}
              y={35}
              width={localSize.width - 20}
              height={localSize.height - 65}
              text={blurb}
              fontSize={12}
              fontFamily="Arial"
              fill={palette.textMuted}
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
            fill={palette.textFaint}
            wrap="none"
            ellipsis={true}
          />
        </>
      ) : (
        <>
          {/* Bookmark icon/indicator (fallback when no metadata) */}
          <Rect
            x={10}
            y={10}
            width={30}
            height={30}
            fill={palette.bookmark.stroke}
            cornerRadius={4}
          />

          {/* URL text (fallback when no metadata) */}
          <Text
            x={50}
            y={15}
            width={localSize.width - 60}
            text={displayUrl}
            fontSize={14}
            fontFamily="Arial"
            fill={palette.bookmark.link}
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
            fill={palette.textMuted}
          />
        </>
      )}

      {/* Resize handles (only when selected) */}
      {isSelected && capabilities.canResizeItems && (
        <>
          {/* Bottom-right */}
          <Circle
            x={localSize.width}
            y={localSize.height}
            radius={RESIZE_HANDLE_SIZE}
            fill={palette.selection}
            draggable
            {...resizeHandleEvents("se")}
            onMouseEnter={(e) => {
              const stage = e.target.getStage();
              if (stage) stage.container().style.cursor = "nwse-resize";
            }}
            onMouseLeave={(e) => {
              const stage = e.target.getStage();
              if (stage) stage.container().style.cursor = "default";
            }}
          />

          {/* Bottom-left */}
          <Circle
            x={0}
            y={localSize.height}
            radius={RESIZE_HANDLE_SIZE}
            fill={palette.selection}
            draggable
            {...resizeHandleEvents("sw")}
            onMouseEnter={(e) => {
              const stage = e.target.getStage();
              if (stage) stage.container().style.cursor = "nesw-resize";
            }}
            onMouseLeave={(e) => {
              const stage = e.target.getStage();
              if (stage) stage.container().style.cursor = "default";
            }}
          />

          {/* Top-right */}
          <Circle
            x={localSize.width}
            y={0}
            radius={RESIZE_HANDLE_SIZE}
            fill={palette.selection}
            draggable
            {...resizeHandleEvents("ne")}
            onMouseEnter={(e) => {
              const stage = e.target.getStage();
              if (stage) stage.container().style.cursor = "nesw-resize";
            }}
            onMouseLeave={(e) => {
              const stage = e.target.getStage();
              if (stage) stage.container().style.cursor = "default";
            }}
          />

          {/* Top-left */}
          <Circle
            x={0}
            y={0}
            radius={RESIZE_HANDLE_SIZE}
            fill={palette.selection}
            draggable
            {...resizeHandleEvents("nw")}
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

/**
 * Memoized BookmarkItem with custom comparison
 *
 * Same optimization strategy as NoteItem:
 * - Prevents re-renders when other canvas items change
 * - Only re-renders when the item itself is updated
 * - Or when selection state or capabilities change
 */
export function areBookmarkItemPropsEqual(
  prevProps: BookmarkItemProps,
  nextProps: BookmarkItemProps,
): boolean {
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

  // Re-render when permissions change (fallback -> loaded, or an access
  // change from the sync server): draggable, the resize handles and the
  // activate/commit callbacks all depend on them. Callbacks are rebuilt by
  // the layer on every render, so they are not compared; a re-render here
  // also picks up the latest ones.
  if (prevProps.capabilities !== nextProps.capabilities) {
    const prev = prevProps.capabilities;
    const next = nextProps.capabilities;
    const keys = new Set([...Object.keys(prev), ...Object.keys(next)]) as Set<
      keyof typeof prev
    >;
    for (const key of keys) {
      if (prev[key] !== next[key]) return false;
    }
  }

  // No changes detected, skip re-render
  return true;
}

export const BookmarkItem = React.memo(
  BookmarkItemComponent,
  areBookmarkItemPropsEqual,
);
