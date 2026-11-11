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

type ImageItemProps = CanvasItemAdapterProps;

const RESIZE_HANDLE_SIZE = 8;
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
  const groupRef = useRef<Konva.Group>(null);
  const [localPosition, setLocalPosition] = useState({
    x: item.positionX,
    y: item.positionY,
  });
  const [localSize, setLocalSize] = useState({
    width: item.width,
    height: item.height,
  });
  const [image, setImage] = useState<HTMLImageElement | null>(null);
  const [imageFailed, setImageFailed] = useState(false);
  const [loadAttempt, setLoadAttempt] = useState(0);

  const content = isImageContent(item.content)
    ? item.content
    : { url: "", filename: "Invalid image" };

  useEffect(() => {
    setLocalPosition({ x: item.positionX, y: item.positionY });
    setLocalSize({ width: item.width, height: item.height });
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
      onDragMove={handleDragMove}
      onDragEnd={handleDragEnd}
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
        fill="#ffffff"
        stroke={isSelected ? "#2196F3" : "#e0e0e0"}
        strokeWidth={isSelected ? 3 : 1}
        shadowColor="black"
        shadowBlur={5}
        shadowOpacity={0.2}
        shadowOffset={{ x: 2, y: 2 }}
        cornerRadius={4}
      />

      {/* Image */}
      {image && (
        <KonvaImage
          image={image}
          x={0}
          y={0}
          width={localSize.width}
          height={localSize.height}
          cornerRadius={4}
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
          fontSize={14}
          fontFamily="Arial"
          fill={imageFailed ? "#b3261e" : "#999"}
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

      {/* Alt text on hover (shown as overlay when selected) */}
      {isSelected && content.alt && (
        <Rect
          x={0}
          y={localSize.height - 30}
          width={localSize.width}
          height={30}
          fill="rgba(0, 0, 0, 0.7)"
          cornerRadius={[0, 0, 4, 4]}
        />
      )}
      {isSelected && content.alt && (
        <Text
          x={8}
          y={localSize.height - 22}
          width={localSize.width - 16}
          text={content.alt}
          fontSize={12}
          fontFamily="Arial"
          fill="#ffffff"
          wrap="none"
          ellipsis={true}
        />
      )}

      {/* Resize handles and delete button */}
      {isSelected && capabilities.canResizeItems && (
        <>
          {/* Resize handles */}
          <Circle
            x={localSize.width}
            y={localSize.height}
            radius={RESIZE_HANDLE_SIZE}
            fill="#2196F3"
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
            radius={RESIZE_HANDLE_SIZE}
            fill="#2196F3"
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
            radius={RESIZE_HANDLE_SIZE}
            fill="#2196F3"
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
            radius={RESIZE_HANDLE_SIZE}
            fill="#2196F3"
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
