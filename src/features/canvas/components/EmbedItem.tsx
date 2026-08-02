import React from "react";
import { Group, Rect, Text } from "react-konva";
import { type CanvasItemAdapterProps, type EmbedContent } from "@/types/canvas";
import {
  EMBED_PREVIEW_LABEL,
  describeEmbedTarget,
} from "@/lib/product-surfaces";
import { commitGroupDragEnd } from "@/features/canvas/lib/geometry-adapter";

type EmbedItemProps = CanvasItemAdapterProps;

/**
 * DEC-011: embeds are presented as link previews. Nothing third-party is loaded
 * or executed here — the card shows where the link points and nothing more, and
 * the CSP keeps `frame-src` at `'none'` so a live embed cannot be introduced by
 * accident.
 */
export const EmbedItem: React.FC<EmbedItemProps> = ({
  item,
  isSelected,
  capabilities,
  onSelect,
  onContextMenu,
  onCommitGeometry,
}) => {
  const content = item.content as EmbedContent;
  const host = describeEmbedTarget(content.url);

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
      <Rect
        width={item.width}
        height={item.height}
        fill="#f8f9fa"
        stroke="#dde2e5"
        strokeWidth={1}
        cornerRadius={8}
      />

      {/* Says what this card is, so it never reads as live content. */}
      <Text
        x={0}
        y={12}
        width={item.width}
        text={`${EMBED_PREVIEW_LABEL} · ${content.embedType.toUpperCase()}`}
        align="center"
        fontSize={11}
        fontFamily="Inter, sans-serif"
        fill="#6c757d"
        ellipsis
      />

      <Text
        x={12}
        y={item.height / 2 - 14}
        width={Math.max(item.width - 24, 0)}
        text={host}
        align="center"
        fontSize={16}
        fontFamily="Inter, sans-serif"
        fill="#343a40"
        ellipsis
      />
      <Text
        x={12}
        y={item.height / 2 + 8}
        width={Math.max(item.width - 24, 0)}
        text={content.url}
        align="center"
        fontSize={10}
        fontFamily="Inter, sans-serif"
        fill="#adb5bd"
        ellipsis
      />

      <Text
        x={0}
        y={item.height - 22}
        width={item.width}
        text="Opens in a new tab"
        align="center"
        fontSize={10}
        fontFamily="Inter, sans-serif"
        fill="#adb5bd"
      />

      {isSelected && (
        <Rect
          x={0}
          y={0}
          width={item.width}
          height={item.height}
          stroke="#0096fd"
          strokeWidth={2}
          cornerRadius={8}
        />
      )}
    </Group>
  );
};
