import React from "react";
import { Group, Rect, Text } from "react-konva";
import {
  type CanvasCapabilities,
  type CanvasItem,
  type CommitItemGeometry,
  type FrameContent,
} from "@/types/canvas";
import { commitGroupDragEnd } from "@/features/canvas/lib/geometry-adapter";

interface FrameItemProps {
  item: CanvasItem;
  isSelected: boolean;
  onSelect: (id: string) => void;
  onContextMenu?: (e: any) => void;
  capabilities: CanvasCapabilities;
  onCommitGeometry: CommitItemGeometry;
}

export const FrameItem: React.FC<FrameItemProps> = ({
  item,
  isSelected,
  onSelect,
  onContextMenu,
  capabilities,
  onCommitGeometry,
}) => {
  const content = item.content as FrameContent;

  return (
    <Group
      id={item.id}
      x={item.positionX}
      y={item.positionY}
      draggable={isSelected && capabilities.canMoveItems}
      onDragEnd={(event) =>
        commitGroupDragEnd(event, (geometry) =>
          onCommitGeometry(item, geometry),
        )
      }
      onClick={(e) => {
        e.cancelBubble = true;
        onSelect(item.id);
      }}
      onTap={(e) => {
        e.cancelBubble = true;
        onSelect(item.id);
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
