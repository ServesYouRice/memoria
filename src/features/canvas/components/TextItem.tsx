import React from 'react';
import { Group, Text } from 'react-konva';
import { CanvasItem, TextContent } from '@/types/canvas';

interface TextItemProps {
    item: CanvasItem;
    isSelected: boolean;
    onSelect: (id: string) => void;
    onDoubleClick?: () => void;
    onContextMenu?: (e: any) => void;
    onChange?: (data: any) => void;
}

export const TextItem: React.FC<TextItemProps> = ({
    item,
    isSelected,
    onSelect,
    onDoubleClick,
    onContextMenu,
}) => {
    const content = item.content as TextContent;

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
            onDblClick={onDoubleClick}
            onDblTap={onDoubleClick}
            onContextMenu={onContextMenu}
        >
            <Text
                text={content.text}
                fontSize={content.fontSize || 16}
                fontFamily={content.fontFamily || 'Inter, sans-serif'}
                fill={content.color || '#000000'}
                align={content.align || 'left'}
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
