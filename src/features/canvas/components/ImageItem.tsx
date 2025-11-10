/**
 * ImageItem Konva Component
 *
 * Displays uploaded images on the canvas
 */

'use client';

import React, { useRef, useState, useEffect } from 'react';
import { Group, Rect, Circle, Text, Image as KonvaImage } from 'react-konva';
import Konva from 'konva';
import { CanvasItem, ImageContent, isImageContent } from '@/types/canvas';
import { useAutosave } from '@/lib/hooks/use-autosave';
import { useDeleteCanvasItem } from '@/lib/hooks/use-canvas-items';

interface ImageItemProps {
  item: CanvasItem;
  isSelected?: boolean;
  onSelect?: () => void;
  onDoubleClick?: () => void;
  onContextMenu?: (e: any) => void;
}

const DELETE_BUTTON_SIZE = 20;

export function ImageItem({ item, isSelected = false, onSelect, onDoubleClick, onContextMenu }: ImageItemProps) {
  const groupRef = useRef<Konva.Group>(null);
  const [localPosition, setLocalPosition] = useState({
    x: item.positionX,
    y: item.positionY,
  });
  const [image, setImage] = useState<HTMLImageElement | null>(null);

  const { saveChanges, isSaving } = useAutosave({
    itemId: item.id,
    version: item.version,
    debounceMs: 500,
  });

  const deleteItem = useDeleteCanvasItem();

  const content = isImageContent(item.content) ? item.content : { url: '', filename: 'Invalid image' };

  useEffect(() => {
    setLocalPosition({ x: item.positionX, y: item.positionY });
  }, [item.positionX, item.positionY]);

  // Load the image
  useEffect(() => {
    if (content.url) {
      const img = new window.Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => {
        setImage(img);
      };
      img.onerror = () => {
        console.error('Failed to load image:', content.url);
      };
      img.src = content.url;
    }
  }, [content.url]);

  const handleDragEnd = (e: Konva.KonvaEventObject<DragEvent>) => {
    const node = e.target;
    saveChanges({
      positionX: node.x(),
      positionY: node.y(),
    });
  };

  const handleDelete = () => {
    if (confirm('Delete this image?')) {
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
      onDblClick={onDoubleClick}
      onDblTap={onDoubleClick}
      onContextMenu={onContextMenu}
    >
      {/* Border/Background */}
      <Rect
        width={item.width}
        height={item.height}
        fill="#ffffff"
        stroke={isSelected ? '#2196F3' : '#e0e0e0'}
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
          width={item.width}
          height={item.height}
          cornerRadius={4}
        />
      )}

      {/* Loading/Error state */}
      {!image && (
        <Text
          x={10}
          y={item.height / 2 - 10}
          width={item.width - 20}
          text="Loading image..."
          fontSize={14}
          fontFamily="Arial"
          fill="#999"
          align="center"
        />
      )}

      {/* Alt text on hover (shown as overlay when selected) */}
      {isSelected && content.alt && (
        <Rect
          x={0}
          y={item.height - 30}
          width={item.width}
          height={30}
          fill="rgba(0, 0, 0, 0.7)"
          cornerRadius={[0, 0, 4, 4]}
        />
      )}
      {isSelected && content.alt && (
        <Text
          x={8}
          y={item.height - 22}
          width={item.width - 16}
          text={content.alt}
          fontSize={12}
          fontFamily="Arial"
          fill="#ffffff"
          wrap="none"
          ellipsis={true}
        />
      )}

      {/* Saving indicator */}
      {isSaving && (
        <Text x={item.width - 80} y={item.height - 25} text="Saving..." fontSize={10} fill="#999" />
      )}

      {/* Delete button */}
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
