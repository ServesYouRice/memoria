import React from "react";
import { Group, Text } from "react-konva";
import { type CanvasItemAdapterProps, type TextContent } from "@/types/canvas";
import { commitGroupDragEnd } from "@/features/canvas/lib/geometry-adapter";

type TextItemProps = CanvasItemAdapterProps;

export const TextItem: React.FC<TextItemProps> = ({
  item,
  isSelected,
  capabilities,
  onSelect,
  onActivate,
  onContextMenu,
  onCommitGeometry,
}) => {
  const content = item.content as TextContent;

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
      onDblClick={onActivate}
      onDblTap={onActivate}
      onContextMenu={onContextMenu}
    >
      <Text
        text={content.text}
        fontSize={content.fontSize || 16}
        fontFamily={content.fontFamily || "Inter, sans-serif"}
        fill={content.color || "#000000"}
        align={content.align || "left"}
        width={item.width}
        // height is usually auto for text, but we can constrain if needed
      />

      {/* Selection Border */}
      {isSelected && (
        <React.Fragment>
          {/* We can use a Rect for selection border around the text */}
        </React.Fragment>
      )}
    </Group>
  );
};
