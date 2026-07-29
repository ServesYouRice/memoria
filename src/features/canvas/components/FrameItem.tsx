import React from "react";
import { Group, Rect, Text } from "react-konva";
import { type CanvasItemAdapterProps, type FrameContent } from "@/types/canvas";
import { commitGroupDragEnd } from "@/features/canvas/lib/geometry-adapter";

type FrameItemProps = CanvasItemAdapterProps;

export const FrameItem: React.FC<FrameItemProps> = ({
  item,
  isSelected,
  capabilities,
  onSelect,
  onContextMenu,
  onCommitGeometry,
}) => {
  const content = item.content as FrameContent;

  return (
    <Group
      id={item.id}
      x={item.positionX}
      y={item.positionY}
      draggable={isSelected && capabilities.canMoveItems}
      onDragEnd={(e) => commitGroupDragEnd(e, onCommitGeometry)}
      onClick={(e) => {
        e.cancelBubble = true;
        onSelect();
      }}
      onTap={(e) => {
        e.cancelBubble = true;
        onSelect();
      }}
      onContextMenu={onContextMenu}
    >
      {/* Title Bar */}
      <Rect
        x={0}
        y={0}
        width={item.width}
        height={30}
        fill={content.backgroundColor || "#f0f0f0"}
        stroke="#e0e0e0"
        strokeWidth={1}
        cornerRadius={[4, 4, 0, 0]}
      />
      <Text
        x={10}
        y={8}
        text={content.title || "Frame"}
        fontSize={14}
        fontFamily="Inter, sans-serif"
        fill="#333"
      />

      {/* Frame Body */}
      <Rect
        x={0}
        y={30}
        width={item.width}
        height={item.height - 30}
        fill="transparent"
        stroke="#e0e0e0"
        strokeWidth={1}
        cornerRadius={[0, 0, 4, 4]}
      />

      {/* Selection Highlight */}
      {isSelected && (
        <Rect
          x={-2}
          y={-2}
          width={item.width + 4}
          height={item.height + 4}
          stroke="#0096fd"
          strokeWidth={2}
          cornerRadius={6}
          listening={false}
        />
      )}
    </Group>
  );
};
