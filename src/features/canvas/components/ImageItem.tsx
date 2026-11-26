/**
 * ImageItem Konva Component
 *
 * Displays uploaded images on the canvas
 */

"use client";

import React, { useRef, useState, useEffect } from "react";
import { Group, Rect, Circle, Text, Image as KonvaImage } from "react-konva";
import type Konva from "konva";
import {
  cornerHandlePosition,
  resizeFromCorner,
  type ResizeCorner,
} from "@/features/canvas/lib/geometry-adapter";
import { isImageContent, type CanvasItemAdapterProps } from "@/types/canvas";
import { toImageProxyUrl } from "@/lib/images/proxy-url";
import { useCanvasPalette } from "@/features/canvas/lib/canvas-palette";
import {
  animateDragLift,
  animateItemFlight,
  setStageCursor,
  zoomInvariantHandleMetrics,
} from "@/features/canvas/lib/canvas-motion";
import { useCanvasStore } from "@/stores/canvasStore";
import { fonts } from "@/lib/theme";

type ImageItemProps = CanvasItemAdapterProps;

const RESIZE_HANDLE_SIZE = 7;
const IMAGE_RADIUS = 10;
const MIN_WIDTH = 100;
const MIN_HEIGHT = 100;

export function ImageItem({
  item,
  isSelected = false,
  capabilities,
  onSelect,
  onActivate,
  onContextMenu,
  onCommitGeometry,
}: ImageItemProps) {
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
  const [image, setImage] = useState<HTMLImageElement | null>(null);
  const [imageFailed, setImageFailed] = useState(false);
  const [loadAttempt, setLoadAttempt] = useState(0);
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

  const content = isImageContent(item.content)
    ? item.content
    : { url: "", filename: "Invalid image" };

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

  useEffect(() => {
    setImage(null);
    setImageFailed(false);
  }, [content.url]);

  // Load the image
  useEffect(() => {
    // Remote image URLs load through the same-origin image proxy (IMP-057).
    const imageSrc = toImageProxyUrl(content.url);
    if (imageSrc) {
      const img = new window.Image();
      img.crossOrigin = "anonymous";
      img.onload = () => {
        setImage(img);
        setImageFailed(false);
      };
      img.onerror = () => {
        console.error("Failed to load image:", content.url);
        setImage(null);
        setImageFailed(true);
      };
      img.src = imageSrc;
    } else {
      setImageFailed(true);
    }
  }, [content.url, loadAttempt]);

  // A failed load is recoverable: the placeholder doubles as a retry target.
  const handleRetryImage = () => {
    setLoadAttempt((attempt) => attempt + 1);
  };

  const handleDragMove = (e: Konva.KonvaEventObject<DragEvent>) => {
    // Only the item body moves the item; a resize handle's drag is its own.
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

  const handleResize = (
    corner: ResizeCorner,
    e: Konva.KonvaEventObject<DragEvent>,
  ) => {
    // The handle's drag must not bubble into the Group's move handlers.
    e.cancelBubble = true;
    const stage = e.target.getStage();
    if (!stage) return;

    // Item geometry is in world space; the Stage is zoomed and panned.
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

  const handleResizeEnd = (
    corner: ResizeCorner,
    e: Konva.KonvaEventObject<DragEvent>,
  ) => {
    e.cancelBubble = true;
    // Put the dragged handle back on its corner of the new size.
    e.target.position(cornerHandlePosition(corner, localSize));
    onCommitGeometry({
      positionX: localPosition.x,
      positionY: localPosition.y,
      width: localSize.width,
      height: localSize.height,
    });
  };

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
      {/* Border/Background */}
      <Rect
        width={localSize.width}
        height={localSize.height}
        fill={palette.surface}
        stroke={
          isSelected
            ? palette.selection
            : isHovered
              ? palette.borderStrong
              : palette.border
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
        cornerRadius={IMAGE_RADIUS}
      />

      {/* Image */}
      {image && (
        <KonvaImage
          image={image}
          x={0}
          y={0}
          width={localSize.width}
          height={localSize.height}
          cornerRadius={IMAGE_RADIUS}
        />
      )}

      {/* Loading/Error state */}
      {!image && (
        <Text
          x={10}
          y={localSize.height / 2 - 10}
          width={localSize.width - 20}
          text={
            imageFailed
              ? `🖼 ${content.filename || "Image"}\nImage unavailable · click to retry`
              : "Loading image…"
          }
          fontSize={13}
          fontFamily={fonts.body}
          fill={imageFailed ? palette.imageError : palette.textFaint}
          align="center"
          onClick={
            imageFailed
              ? (event) => {
                  event.cancelBubble = true;
                  handleRetryImage();
                }
              : undefined
          }
          onTap={
            imageFailed
              ? (event) => {
                  event.cancelBubble = true;
                  handleRetryImage();
                }
              : undefined
          }
        />
      )}

      {/* Alt text caption shown when selected */}
      {isSelected && content.alt && (
        <Rect
          x={0}
          y={localSize.height - 32}
          width={localSize.width}
          height={32}
          fill={palette.scrim}
          cornerRadius={[0, 0, IMAGE_RADIUS, IMAGE_RADIUS]}
        />
      )}
      {isSelected && content.alt && (
        <Text
          x={10}
          y={localSize.height - 22}
          width={localSize.width - 20}
          text={content.alt}
          fontSize={12}
          fontFamily={fonts.body}
          fill={palette.scrimText}
          wrap="none"
          ellipsis={true}
        />
      )}

      {/* Resize handles */}
      {isSelected && capabilities.canResizeItems && (
        <>
          <Circle
            x={localSize.width}
            y={localSize.height}
            radius={handleMetrics.radius}
            fill={palette.surface}
            stroke={palette.selection}
            strokeWidth={handleMetrics.strokeWidth}
            draggable
            onDragMove={(e) => handleResize("se", e)}
            onDragEnd={(e) => handleResizeEnd("se", e)}
            onMouseEnter={(e) => {
              const stage = e.target.getStage();
              if (stage) stage.container().style.cursor = "nwse-resize";
            }}
            onMouseLeave={(e) => {
              const stage = e.target.getStage();
              if (stage) stage.container().style.cursor = "default";
            }}
          />

          <Circle
            x={0}
            y={localSize.height}
            radius={handleMetrics.radius}
            fill={palette.surface}
            stroke={palette.selection}
            strokeWidth={handleMetrics.strokeWidth}
            draggable
            onDragMove={(e) => handleResize("sw", e)}
            onDragEnd={(e) => handleResizeEnd("sw", e)}
            onMouseEnter={(e) => {
              const stage = e.target.getStage();
              if (stage) stage.container().style.cursor = "nesw-resize";
            }}
            onMouseLeave={(e) => {
              const stage = e.target.getStage();
              if (stage) stage.container().style.cursor = "default";
            }}
          />

          <Circle
            x={localSize.width}
            y={0}
            radius={handleMetrics.radius}
            fill={palette.surface}
            stroke={palette.selection}
            strokeWidth={handleMetrics.strokeWidth}
            draggable
            onDragMove={(e) => handleResize("ne", e)}
            onDragEnd={(e) => handleResizeEnd("ne", e)}
            onMouseEnter={(e) => {
              const stage = e.target.getStage();
              if (stage) stage.container().style.cursor = "nesw-resize";
            }}
            onMouseLeave={(e) => {
              const stage = e.target.getStage();
              if (stage) stage.container().style.cursor = "default";
            }}
          />

          <Circle
            x={0}
            y={0}
            radius={handleMetrics.radius}
            fill={palette.surface}
            stroke={palette.selection}
            strokeWidth={handleMetrics.strokeWidth}
            draggable
            onDragMove={(e) => handleResize("nw", e)}
            onDragEnd={(e) => handleResizeEnd("nw", e)}
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
