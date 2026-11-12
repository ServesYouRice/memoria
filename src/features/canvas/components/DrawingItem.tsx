import React from "react";
import { Group, Line, Rect } from "react-konva";
import { isDrawingContent, type CanvasItemAdapterProps } from "@/types/canvas";
import { commitGroupDragEnd } from "@/features/canvas/lib/geometry-adapter";
import { useCanvasPalette } from "@/features/canvas/lib/canvas-palette";

type DrawingItemProps = CanvasItemAdapterProps;

export const DrawingItem: React.FC<DrawingItemProps> = ({
  item,
  isSelected,
  capabilities,
  onSelect,
  onContextMenu,
  onCommitGeometry,
}) => {
  const palette = useCanvasPalette();
  if (!isDrawingContent(item.content)) {
    return null;
  }

  const { paths } = item.content;
  const { positionX, positionY, width, height, zIndex } = item;

  return (
    <Group
      id={item.id}
      x={positionX}
      y={positionY}
      width={width}
      height={height}
      zIndex={zIndex}
      onClick={(e) => {
        e.cancelBubble = true;
        onSelect?.();
      }}
      onTap={(e) => {
        e.cancelBubble = true;
        onSelect?.();
      }}
      onContextMenu={onContextMenu}
      draggable={isSelected && capabilities.canMoveItems}
      onDragEnd={(e) => commitGroupDragEnd(e, onCommitGeometry)}
    >
      {/* Invisible hit area to make selecting easier */}
      <Rect
        width={width}
        height={height}
        fill="transparent"
        // strokeWidth={1}
      />

      {paths.map((path, index) => (
        <Line
          key={index}
          points={path.points}
          stroke={path.stroke}
          strokeWidth={path.strokeWidth}
          opacity={path.opacity ?? 1}
          tension={path.tension ?? 0.5}
          lineCap="round"
          lineJoin="round"
        />
      ))}

      {/* Selection indicator only renders when needed by parent, or we can render it here */}
      {isSelected && (
        <Rect
          width={width}
          height={height}
          stroke={palette.selection}
          strokeWidth={1}
          dash={[5, 5]}
          listening={false}
        />
      )}
    </Group>
  );
};
