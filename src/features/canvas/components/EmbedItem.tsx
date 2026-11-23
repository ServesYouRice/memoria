import React from "react";
import { Group, Rect, Text } from "react-konva";
import { type CanvasItemAdapterProps, type EmbedContent } from "@/types/canvas";
import { EMBED_PREVIEW_LABEL, describeEmbedCard } from "@/lib/product-surfaces";
import { commitGroupDragEnd } from "@/features/canvas/lib/geometry-adapter";
import { useCanvasPalette } from "@/features/canvas/lib/canvas-palette";
import { fonts } from "@/lib/theme";

type EmbedItemProps = CanvasItemAdapterProps;

const CARD_RADIUS = 12;

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
  const palette = useCanvasPalette();
  const content = item.content as EmbedContent;
  // IMP-114: a video card names the video and where it is from.
  const card = describeEmbedCard(content);

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
        fill={palette.surface}
        stroke={isSelected ? palette.selection : palette.border}
        strokeWidth={isSelected ? 2 : 1}
        shadowColor="black"
        shadowBlur={14}
        shadowOpacity={palette.cardShadowOpacity}
        shadowOffset={{ x: 0, y: 4 }}
        shadowForStrokeEnabled={false}
        perfectDrawEnabled={false}
        cornerRadius={CARD_RADIUS}
      />

      {/* Says what this card is, so it never reads as live content. */}
      <Text
        x={12}
        y={14}
        width={Math.max(item.width - 24, 0)}
        text={`${EMBED_PREVIEW_LABEL} · ${card.isVideo ? "VIDEO" : content.embedType.toUpperCase()}`}
        align="center"
        fontSize={11}
        fontStyle="bold"
        fontFamily={fonts.body}
        fill={palette.accentText}
        ellipsis
      />

      <Text
        x={14}
        y={item.height / 2 - 14}
        width={Math.max(item.width - 28, 0)}
        text={card.title}
        align="center"
        fontSize={16}
        fontStyle="bold"
        fontFamily={fonts.heading}
        fill={palette.text}
        wrap="none"
        ellipsis
      />
      <Text
        x={14}
        y={item.height / 2 + 10}
        width={Math.max(item.width - 28, 0)}
        text={card.source}
        align="center"
        fontSize={11}
        fontFamily={fonts.body}
        fill={palette.textMuted}
        ellipsis
      />

      <Text
        x={0}
        y={item.height - 24}
        width={item.width}
        text="Opens in a new tab ↗"
        align="center"
        fontSize={10.5}
        fontFamily={fonts.body}
        fill={palette.textFaint}
      />
    </Group>
  );
};
