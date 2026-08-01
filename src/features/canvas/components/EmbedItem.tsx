import React from "react";
import { Group, Rect, Text } from "react-konva";
import {
  type CanvasCapabilities,
  type CanvasItem,
  type CommitItemGeometry,
  type EmbedContent,
} from "@/types/canvas";
import { commitGroupDragEnd } from "@/features/canvas/lib/geometry-adapter";
import {
  EMBED_PREVIEW_LABEL,
  describeEmbedTarget,
} from "@/lib/product-surfaces";

interface EmbedItemProps {
  item: CanvasItem;
  isSelected: boolean;
  onSelect: (id: string) => void;
  onContextMenu?: (e: any) => void;
  capabilities: CanvasCapabilities;
  onCommitGeometry: CommitItemGeometry;
}

export const EmbedItem: React.FC<EmbedItemProps> = ({
  item,
  isSelected,
  onSelect,
  onContextMenu,
  capabilities,
  onCommitGeometry,
}) => {
  const content = item.content as EmbedContent;

  // Placeholder icon for embeds (could be a real image loaded)
  // const [icon] = useImage('/icons/embed-placeholder.png');

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
      <Rect
        width={item.width}
        height={item.height}
        fill="#f8f9fa"
        stroke="#dde2e5"
        strokeWidth={1}
        cornerRadius={8}
      />

      {/* Visual Indicator of Embed Type */}
      <Text
        x={0}
        y={item.height / 2 - 10}
        width={item.width}
        text={`${EMBED_PREVIEW_LABEL} · ${describeEmbedTarget(content.url)}`}
        align="center"
        fontSize={16}
        fontFamily="Inter, sans-serif"
        fill="#6c757d"
      />
      <Text
        x={0}
        y={item.height / 2 + 10}
        width={item.width}
        text="Opens as a link; no live content is loaded in the canvas."
        align="center"
        fontSize={10}
        fontFamily="Inter, sans-serif"
        fill="#adb5bd"
        ellipsis={true}
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
