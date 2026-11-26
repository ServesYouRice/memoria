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

import { fonts } from "@/lib/theme";
import React, { useRef, useState, useEffect } from "react";
import { Group, Rect, Text, Circle, Image as KonvaImage } from "react-konva";
import type Konva from "konva";
import { isBookmarkContent, type CanvasItemAdapterProps } from "@/types/canvas";
import { toImageProxyUrl } from "@/lib/images/proxy-url";
import { useCanvasPalette } from "@/features/canvas/lib/canvas-palette";
import {
  animateDragLift,
  animateItemFlight,
  setStageCursor,
  zoomInvariantHandleMetrics,
} from "@/features/canvas/lib/canvas-motion";
import { useCanvasStore } from "@/stores/canvasStore";

type BookmarkItemProps = CanvasItemAdapterProps;

const RESIZE_HANDLE_SIZE = 7;
const MIN_WIDTH = 200;
const MIN_HEIGHT = 80;
const CARD_RADIUS = 12;
const FOOTER_HEIGHT = 30;
const PADDING = 14;

function extractDomain(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

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
  const localPositionRef = useRef(localPosition);
  localPositionRef.current = localPosition;
  const [localSize, setLocalSize] = useState({
    width: item.width,
    height: item.height,
  });
  const prevSizeRef = useRef({ width: item.width, height: item.height });
  const [favicon, setFavicon] = useState<HTMLImageElement | null>(null);
  const [previewImg, setPreviewImg] = useState<HTMLImageElement | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const isDraggingRef = useRef(false);
  const [isHovered, setIsHovered] = useState(false);
  const currentZoom = useCanvasStore((state) =>
    isSelected && capabilities.canResizeItems ? state.currentZoom : 1,
  );
  const handleMetrics = zoomInvariantHandleMetrics(
    currentZoom,
    RESIZE_HANDLE_SIZE,
    2,
  );

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
    const prevPos = localPositionRef.current;
    const prevSize = prevSizeRef.current;
    const sizeUnchanged =
      prevSize.width === item.width && prevSize.height === item.height;
    prevSizeRef.current = { width: item.width, height: item.height };

    setLocalPosition({ x: item.positionX, y: item.positionY });
    setLocalSize({ width: item.width, height: item.height });

    if (!isDraggingRef.current && sizeUnchanged) {
      animateItemFlight(groupRef.current, prevPos, {
        x: item.positionX,
        y: item.positionY,
      });
    }
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
        setFavicon(null);
      };
      img.src = faviconSrc;
    } else {
      setFavicon(null);
    }
  }, [content.favicon]);

  // Load Open Graph preview cover image when unfurled
  useEffect(() => {
    const previewSrc = toImageProxyUrl(content.previewImage);
    if (previewSrc) {
      const img = new window.Image();
      img.crossOrigin = "anonymous";
      img.onload = () => setPreviewImg(img);
      img.onerror = () => setPreviewImg(null);
      img.src = previewSrc;
    } else {
      setPreviewImg(null);
    }
  }, [content.previewImage]);

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
  const domainLabel = content.siteName || extractDomain(content.url);
  const showCover = Boolean(previewImg) && localSize.height >= 165;
  const coverHeight = showCover
    ? Math.min(104, Math.round(localSize.height * 0.42))
    : 0;
  const bodyTop = coverHeight + PADDING;
  const footerTop = Math.max(bodyTop, localSize.height - FOOTER_HEIGHT);
  const innerWidth = Math.max(0, localSize.width - PADDING * 2);

  return (
    <Group
      ref={groupRef}
      x={localPosition.x}
      y={localPosition.y}
      draggable={capabilities.canMoveItems}
      onDragStart={(e) => {
        if (e.target !== e.currentTarget) return;
        isDraggingRef.current = true;
        setIsDragging(true);
        animateDragLift(groupRef.current, true);
        setStageCursor(e.target, "grabbing");
      }}
      onDragMove={handleDragMove}
      onDragEnd={(e) => {
        if (e.target === e.currentTarget) {
          isDraggingRef.current = false;
          setIsDragging(false);
          animateDragLift(groupRef.current, false);
          setStageCursor(
            e.target,
            capabilities.canMoveItems ? "grab" : "default",
          );
        }
        handleDragEnd(e);
      }}
      onMouseEnter={(e) => {
        setIsHovered(true);
        if (capabilities.canMoveItems) setStageCursor(e.target, "grab");
      }}
      onMouseLeave={(e) => {
        setIsHovered(false);
        setStageCursor(e.target, "default");
      }}
      onClick={onSelect}
      onTap={onSelect}
      onDblClick={onActivate}
      onDblTap={onActivate}
      onContextMenu={onContextMenu}
    >
      {/* Main bookmark card surface */}
      <Rect
        width={localSize.width}
        height={localSize.height}
        fill={palette.bookmark.fill}
        stroke={
          isSelected
            ? palette.selection
            : isHovered
              ? palette.borderStrong
              : palette.bookmark.stroke
        }
        strokeWidth={isSelected ? 2 : 1}
        shadowColor="black"
        shadowBlur={isDragging ? 24 : 14}
        shadowOpacity={
          isDragging
            ? Math.min(0.48, palette.cardShadowOpacity * 1.45)
            : palette.cardShadowOpacity
        }
        shadowOffset={isDragging ? { x: 0, y: 10 } : { x: 0, y: 4 }}
        shadowForStrokeEnabled={false}
        perfectDrawEnabled={false}
        cornerRadius={CARD_RADIUS}
      />

      {/* Optional unfurled Open Graph cover image */}
      {showCover && previewImg && (
        <Group
          clipX={0}
          clipY={0}
          clipWidth={localSize.width}
          clipHeight={coverHeight}
          listening={false}
        >
          <KonvaImage
            image={previewImg}
            x={0}
            y={0}
            width={localSize.width}
            height={coverHeight}
            cornerRadius={[CARD_RADIUS, CARD_RADIUS, 0, 0]}
          />
          <Rect
            x={0}
            y={coverHeight - 1}
            width={localSize.width}
            height={1}
            fill={palette.border}
            listening={false}
          />
        </Group>
      )}

      {/* Subtle footer band */}
      <Rect
        x={1}
        y={footerTop}
        width={Math.max(0, localSize.width - 2)}
        height={Math.max(0, FOOTER_HEIGHT - 1)}
        fill={palette.bookmark.footerBg}
        cornerRadius={[0, 0, CARD_RADIUS - 1, CARD_RADIUS - 1]}
        listening={false}
        perfectDrawEnabled={false}
      />
      <Rect
        x={1}
        y={footerTop}
        width={Math.max(0, localSize.width - 2)}
        height={1}
        fill={palette.border}
        listening={false}
      />

      {/* Content area with metadata */}
      {hasMetadata ? (
        <>
          {/* Title */}
          {content.title && (
            <Text
              x={PADDING}
              y={bodyTop}
              width={innerWidth}
              text={content.title}
              fontSize={15}
              fontStyle="bold"
              lineHeight={1.3}
              fontFamily={fonts.heading}
              fill={palette.bookmark.text}
              wrap="none"
              ellipsis={true}
              listening={false}
              perfectDrawEnabled={false}
            />
          )}

          {/* Description / AI summary */}
          {blurb && footerTop - (bodyTop + 26) > 14 && (
            <Text
              x={PADDING}
              y={bodyTop + 24}
              width={innerWidth}
              height={Math.max(0, footerTop - bodyTop - 32)}
              text={blurb}
              fontSize={12.5}
              lineHeight={1.45}
              fontFamily={fonts.body}
              fill={palette.textMuted}
              wrap="word"
              ellipsis={true}
              listening={false}
              perfectDrawEnabled={false}
            />
          )}
        </>
      ) : (
        <>
          {/* Accent link badge (fallback when no metadata) */}
          <Rect
            x={PADDING}
            y={bodyTop}
            width={28}
            height={28}
            fill={palette.accentSoft}
            cornerRadius={7}
            listening={false}
          />
          <Text
            x={PADDING}
            y={bodyTop + 7}
            width={28}
            text="↗"
            align="center"
            fontSize={13}
            fontStyle="bold"
            fontFamily={fonts.body}
            fill={palette.accentText}
            listening={false}
          />

          {/* URL text (fallback when no metadata) */}
          <Text
            x={PADDING + 38}
            y={bodyTop + 6}
            width={Math.max(0, innerWidth - 38)}
            text={displayUrl}
            fontSize={14}
            fontStyle="bold"
            fontFamily={fonts.heading}
            fill={palette.bookmark.link}
            wrap="none"
            ellipsis={true}
            listening={false}
          />
        </>
      )}

      {/* Footer: favicon + domain + open cue */}
      {favicon && (
        <KonvaImage
          image={favicon}
          x={PADDING}
          y={footerTop + 7}
          width={16}
          height={16}
          listening={false}
        />
      )}
      <Text
        x={favicon ? PADDING + 22 : PADDING}
        y={footerTop + 9}
        width={Math.max(0, innerWidth - (favicon ? 42 : 20))}
        text={domainLabel}
        fontSize={11}
        fontFamily={fonts.body}
        fill={palette.textMuted}
        wrap="none"
        ellipsis={true}
        listening={false}
      />
      <Text
        x={localSize.width - PADDING - 14}
        y={footerTop + 8}
        width={14}
        text="↗"
        align="right"
        fontSize={12}
        fontFamily={fonts.body}
        fill={palette.bookmark.link}
        listening={false}
      />

      {/* Resize handles (only when selected) */}
      {isSelected && capabilities.canResizeItems && (
        <>
          {/* Bottom-right */}
          <Circle
            x={localSize.width}
            y={localSize.height}
            radius={handleMetrics.radius}
            fill={palette.surface}
            stroke={palette.selection}
            strokeWidth={handleMetrics.strokeWidth}
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
            radius={handleMetrics.radius}
            fill={palette.surface}
            stroke={palette.selection}
            strokeWidth={handleMetrics.strokeWidth}
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
            radius={handleMetrics.radius}
            fill={palette.surface}
            stroke={palette.selection}
            strokeWidth={handleMetrics.strokeWidth}
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
            radius={handleMetrics.radius}
            fill={palette.surface}
            stroke={palette.selection}
            strokeWidth={handleMetrics.strokeWidth}
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
