import React from "react";
import { Group, Rect, Text } from "react-konva";
import { type CanvasItemAdapterProps, type FrameContent } from "@/types/canvas";
import { commitGroupDragEnd } from "@/features/canvas/lib/geometry-adapter";
import {
  CANVAS_PALETTE,
  useCanvasPalette,
} from "@/features/canvas/lib/canvas-palette";
import { fonts } from "@/lib/theme";

interface FrameItemProps extends CanvasItemAdapterProps {
  childCount?: number;
}

const FRAME_RADIUS = 16;
const TAB_HEIGHT = 28;
const TAB_GAP = 8;
const TAB_OFFSET_Y = -(TAB_HEIGHT + TAB_GAP);

export const FrameItem: React.FC<FrameItemProps> = ({
  item,
  isSelected,
  capabilities,
  onSelect,
  onContextMenu,
  onCommitGeometry,
  childCount,
}) => {
  const palette = useCanvasPalette();
  const content = item.content as FrameContent;
  const title = content.title || "Frame";
  const showCount = typeof childCount === "number" && childCount > 0;
  const countText = showCount ? String(childCount) : "";
  const countPillWidth = showCount
    ? Math.max(20, countText.length * 7 + 12)
    : 0;
  const maxTabWidth = Math.max(96, item.width);
  const titlePadLeft = 12;
  const titlePadRight = showCount ? 6 + countPillWidth + 8 : 12;
  const estimatedTitleWidth = Math.max(40, Math.ceil(title.length * 7.8));
  const titleWidth = Math.min(
    estimatedTitleWidth,
    Math.max(40, maxTabWidth - titlePadLeft - titlePadRight),
  );
  const tabWidth = Math.min(
    maxTabWidth,
    titlePadLeft + titleWidth + titlePadRight,
  );
  const titleColor = content.backgroundColor
    ? CANVAS_PALETTE.light.text
    : palette.text;

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
        strokeWidth={isSelected ? 2 : 1.25}
        cornerRadius={FRAME_RADIUS}
        perfectDrawEnabled={false}
      />

      {/* Top-left floating pill label tab */}
      <Rect
        x={0}
        y={TAB_OFFSET_Y}
        width={tabWidth}
        height={TAB_HEIGHT}
        fill={content.backgroundColor || palette.frameFill}
        stroke={isSelected ? palette.selection : palette.borderStrong}
        strokeWidth={isSelected ? 1.75 : 1}
        cornerRadius={TAB_HEIGHT / 2}
        shadowEnabled
        shadowColor={palette.shadow}
        shadowBlur={8}
        shadowOffset={{ x: 0, y: 2 }}
        shadowOpacity={palette.cardShadowOpacity}
        shadowForStrokeEnabled={false}
        perfectDrawEnabled={false}
      />
      <Text
        x={titlePadLeft}
        y={TAB_OFFSET_Y + 7}
        width={titleWidth}
        text={title}
        fontSize={13}
        fontStyle="bold"
        fontFamily={fonts.heading}
        ellipsis
        wrap="none"
        fill={titleColor}
        listening={false}
      />
      {showCount && (
        <>
          <Rect
            x={tabWidth - 8 - countPillWidth}
            y={TAB_OFFSET_Y + 5}
            width={countPillWidth}
            height={18}
            cornerRadius={9}
            fill={palette.surface}
            stroke={palette.border}
            strokeWidth={1}
            listening={false}
            perfectDrawEnabled={false}
          />
          <Text
            x={tabWidth - 8 - countPillWidth}
            y={TAB_OFFSET_Y + 8}
            width={countPillWidth}
            align="center"
            text={countText}
            fontSize={11}
            fontStyle="bold"
            fontFamily={fonts.body}
            fill={palette.textMuted}
            listening={false}
          />
        </>
      )}
    </Group>
  );
};
