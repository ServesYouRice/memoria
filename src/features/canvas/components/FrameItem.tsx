import React from "react";
import { Group, Rect, Text } from "react-konva";
import { type CanvasItemAdapterProps, type FrameContent } from "@/types/canvas";
import { commitGroupDragEnd } from "@/features/canvas/lib/geometry-adapter";
import {
  CANVAS_PALETTE,
  useCanvasPalette,
} from "@/features/canvas/lib/canvas-palette";
import { fonts } from "@/lib/theme";

type FrameItemProps = CanvasItemAdapterProps;

const FRAME_RADIUS = 16;
const HEADER_HEIGHT = 36;

export const FrameItem: React.FC<FrameItemProps> = ({
  item,
  isSelected,
  capabilities,
  onSelect,
  onContextMenu,
  onCommitGeometry,
}) => {
  const palette = useCanvasPalette();
  const content = item.content as FrameContent;
  const title = content.title || "Frame";

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
      {/* Soft section frame body */}
      <Rect
        x={0}
        y={0}
        width={item.width}
        height={item.height}
        fill={palette.frameBodyTint}
        stroke={isSelected ? palette.selection : palette.borderStrong}
        strokeWidth={isSelected ? 2 : 1}
        cornerRadius={FRAME_RADIUS}
        perfectDrawEnabled={false}
      />

      {/* Title Bar */}
      <Rect
        x={0}
        y={0}
        width={item.width}
        height={HEADER_HEIGHT}
        fill={content.backgroundColor || palette.frameFill}
        stroke={isSelected ? palette.selection : palette.borderStrong}
        strokeWidth={1}
        cornerRadius={[FRAME_RADIUS, FRAME_RADIUS, 0, 0]}
        perfectDrawEnabled={false}
      />
      <Text
        x={14}
        y={10}
        width={Math.max(0, item.width - 28)}
        text={title}
        fontSize={14}
        fontStyle="bold"
        fontFamily={fonts.heading}
        ellipsis
        wrap="none"
        fill={
          content.backgroundColor ? CANVAS_PALETTE.light.text : palette.text
        }
        listening={false}
      />
    </Group>
  );
};
