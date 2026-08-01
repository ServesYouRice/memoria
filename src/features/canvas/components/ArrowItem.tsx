import React from "react";
import { Group, Arrow } from "react-konva";
import {
  type CanvasCapabilities,
  type CanvasItem,
  type CommitItemGeometry,
  type ArrowContent,
} from "@/types/canvas";
import { commitGroupDragEnd } from "@/features/canvas/lib/geometry-adapter";

interface ArrowItemProps {
  item: CanvasItem;
  isSelected: boolean;
  onSelect: (id: string) => void;
  onContextMenu?: (e: any) => void;
  capabilities: CanvasCapabilities;
  onCommitGeometry: CommitItemGeometry;
}

export const ArrowItem: React.FC<ArrowItemProps> = ({
  item,
  isSelected,
  onSelect,
  onContextMenu,
  capabilities,
  onCommitGeometry,
}) => {
  const content = item.content as ArrowContent;

  // Default points if not specified (should be validated upstream but fallback here)
  const start = content.startPoint || { x: 0, y: 0 };
  const end = content.endPoint || { x: 100, y: 100 };

  // Points for Konva Arrow: [x1, y1, x2, y2, ...]
  // We offset by item.positionX/Y because the Group is positioned there.
  // Actually, usually Arrows are absolute on the canvas, or relative to the group.
  // If the Group is at item.positionX/Y, then points inside should be relative.
  // However, for connectors, it's often easier to have the Group at 0,0 and Arrow points absolute.
  // BUT consistent item behavior implies Group is at Position.
  // Let's assume content.startPoint/endPoint are RELATIVE to the item position.

  const points = [start.x, start.y, end.x, end.y];

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
      <Arrow
        points={points}
        stroke={content.stroke || "#000000"}
        strokeWidth={content.strokeWidth || 2}
        fill={content.stroke || "#000000"}
        pointerLength={10}
        pointerWidth={10}
        opacity={1}
        lineCap="round"
        lineJoin="round"
      />
      {/* Selection highlight */}
      {isSelected && (
        <Arrow
          points={points}
          stroke="#0096fd"
          strokeWidth={1}
          opacity={0.5}
          dash={[5, 5]}
        />
      )}
    </Group>
  );
};
