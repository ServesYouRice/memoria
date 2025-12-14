import React from 'react';
import { Group, Rect, Text } from 'react-konva';
import { CanvasItem, EmbedContent } from '@/types/canvas';

interface EmbedItemProps {
    item: CanvasItem;
    isSelected: boolean;
    onSelect: (id: string) => void;
    onContextMenu?: (e: any) => void;
}

export const EmbedItem: React.FC<EmbedItemProps> = ({
    item,
    isSelected,
    onSelect,
    onContextMenu,
}) => {
    const content = item.content as EmbedContent;

    // Placeholder icon for embeds (could be a real image loaded)
    // const [icon] = useImage('/icons/embed-placeholder.png'); 

    return (
        <Group
            id={item.id}
            x={item.positionX}
            y={item.positionY}
            draggable={isSelected}
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
                text={content.embedType.toUpperCase()}
                align="center"
                fontSize={16}
                fontFamily="Inter, sans-serif"
                fill="#6c757d"
            />
            <Text
                x={0}
                y={item.height / 2 + 10}
                width={item.width}
                text={content.url}
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
