import React from "react";
import {
  Rect,
  Circle,
  RegularPolygon,
  Star,
  Arrow as KonvaArrow,
  Group,
} from "react-konva";
import {
  type CanvasCapabilities,
  type CanvasItem,
  type CommitItemGeometry,
  isShapeContent,
} from "@/types/canvas";
import { commitGroupDragEnd } from "@/features/canvas/lib/geometry-adapter";

interface ShapeItemProps {
  item: CanvasItem;
  isSelected?: boolean;
  onSelect?: () => void;
  onDoubleClick?: () => void;
  onContextMenu?: (e: any) => void;
  capabilities: CanvasCapabilities;
  onCommitGeometry: CommitItemGeometry;
}

export const ShapeItem: React.FC<ShapeItemProps> = React.memo(
  ({
    item,
    isSelected,
    onSelect,
    onDoubleClick,
    onContextMenu,
    capabilities,
    onCommitGeometry,
  }) => {
    if (!isShapeContent(item.content)) {
      return null;
    }

    const content = item.content;
    const { width, height, positionX, positionY, zIndex } = item;

    const {
      shapeType,
      stroke = "#000000",
      fill = "transparent",
      strokeWidth = 2,
      radius = 0,
    } = content;

    const commonProps = {
      width,
      height,
      stroke,
      fill,
      strokeWidth,
      shadowColor: isSelected ? "#3b82f6" : "transparent",
      shadowBlur: isSelected ? 10 : 0,
      shadowOpacity: 0.5,
    };

    const renderShape = () => {
      switch (shapeType) {
        case "rectangle":
          return <Rect {...commonProps} cornerRadius={radius} />;

        case "circle":
          return (
            <Circle
              {...commonProps}
              width={width}
              height={height}
              radius={Math.min(width, height) / 2}
              x={width / 2}
              y={height / 2}
              offset={{ x: 0, y: 0 }}
            />
          );

        case "triangle":
          return (
            <RegularPolygon
              {...commonProps}
              sides={3}
              radius={Math.min(width, height) / 2}
              x={width / 2}
              y={height / 2}
            />
          );

        case "diamond":
          return (
            <RegularPolygon
              {...commonProps}
              sides={4}
              radius={Math.min(width, height) / 2}
              x={width / 2}
              y={height / 2}
              rotation={45}
            />
          );

        case "star":
          return (
            <Star
              {...commonProps}
              numPoints={5}
              innerRadius={Math.min(width, height) / 4}
              outerRadius={Math.min(width, height) / 2}
              x={width / 2}
              y={height / 2}
            />
          );

        case "arrow_shape":
          return (
            <KonvaArrow
              {...commonProps}
              points={[0, height / 2, width, height / 2]}
              pointerLength={20}
              pointerWidth={20}
              fill={stroke}
              stroke={stroke}
            />
          );

        default:
          return <Rect {...commonProps} />;
      }
    };

    return (
      <Group
        id={item.id}
        x={positionX}
        y={positionY}
        width={width}
        height={height}
        zIndex={zIndex}
        onClick={onSelect}
        onTap={onSelect}
        onDblClick={onDoubleClick}
        onDblTap={onDoubleClick}
        onContextMenu={onContextMenu}
        draggable={isSelected && capabilities.canMoveItems}
        onDragEnd={(event) =>
          commitGroupDragEnd(event, (geometry) =>
            onCommitGeometry(item, geometry),
          )
        }
      >
        {renderShape()}
      </Group>
    );
  },
);

ShapeItem.displayName = "ShapeItem";
