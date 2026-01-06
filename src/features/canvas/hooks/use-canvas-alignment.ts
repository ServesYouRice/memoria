'use client';

import { useCallback } from 'react';
import { type CanvasItem } from '@/types/canvas';

interface UseCanvasAlignmentOptions {
    selectedItemIds: Set<string>;
    allItems: CanvasItem[];
    updateItem: (data: { itemId: string; positionX?: number; positionY?: number }) => void;
}

export type AlignmentType = 'left' | 'center' | 'right' | 'top' | 'middle' | 'bottom';
export type DistributionType = 'horizontal' | 'vertical';

/**
 * Canvas Alignment Hook
 * 
 * Provides align and distribute operations for multi-selected items.
 */
export function useCanvasAlignment({
    selectedItemIds,
    allItems,
    updateItem,
}: UseCanvasAlignmentOptions) {

    const handleAlign = useCallback((type: AlignmentType) => {
        if (selectedItemIds.size < 2) return;

        const selectedItems = allItems.filter(item => selectedItemIds.has(item.id));
        if (selectedItems.length < 2) return;

        // Calculate bounds
        const bounds = {
            left: Math.min(...selectedItems.map(i => i.positionX)),
            right: Math.max(...selectedItems.map(i => i.positionX + i.width)),
            top: Math.min(...selectedItems.map(i => i.positionY)),
            bottom: Math.max(...selectedItems.map(i => i.positionY + i.height)),
        };

        const centerX = (bounds.left + bounds.right) / 2;
        const centerY = (bounds.top + bounds.bottom) / 2;

        selectedItems.forEach(item => {
            let newX = item.positionX;
            let newY = item.positionY;

            switch (type) {
                case 'left':
                    newX = bounds.left;
                    break;
                case 'center':
                    newX = centerX - item.width / 2;
                    break;
                case 'right':
                    newX = bounds.right - item.width;
                    break;
                case 'top':
                    newY = bounds.top;
                    break;
                case 'middle':
                    newY = centerY - item.height / 2;
                    break;
                case 'bottom':
                    newY = bounds.bottom - item.height;
                    break;
            }

            if (newX !== item.positionX || newY !== item.positionY) {
                updateItem({
                    itemId: item.id,
                    positionX: newX,
                    positionY: newY,
                });
            }
        });
    }, [selectedItemIds, allItems, updateItem]);

    const handleDistribute = useCallback((type: DistributionType) => {
        if (selectedItemIds.size < 3) return;

        const selectedItems = allItems.filter(item => selectedItemIds.has(item.id));
        if (selectedItems.length < 3) return;

        if (type === 'horizontal') {
            // Sort by X position
            const sorted = [...selectedItems].sort((a, b) => a.positionX - b.positionX);
            const first = sorted[0];
            const last = sorted[sorted.length - 1];

            const totalWidth = sorted.reduce((sum, item) => sum + item.width, 0);
            const availableSpace = (last.positionX + last.width) - first.positionX - totalWidth;
            const gap = availableSpace / (sorted.length - 1);

            let currentX = first.positionX;
            sorted.forEach((item, index) => {
                if (index > 0) {
                    updateItem({
                        itemId: item.id,
                        positionX: currentX,
                    });
                }
                currentX += item.width + gap;
            });
        } else {
            // Sort by Y position
            const sorted = [...selectedItems].sort((a, b) => a.positionY - b.positionY);
            const first = sorted[0];
            const last = sorted[sorted.length - 1];

            const totalHeight = sorted.reduce((sum, item) => sum + item.height, 0);
            const availableSpace = (last.positionY + last.height) - first.positionY - totalHeight;
            const gap = availableSpace / (sorted.length - 1);

            let currentY = first.positionY;
            sorted.forEach((item, index) => {
                if (index > 0) {
                    updateItem({
                        itemId: item.id,
                        positionY: currentY,
                    });
                }
                currentY += item.height + gap;
            });
        }
    }, [selectedItemIds, allItems, updateItem]);

    return {
        handleAlign,
        handleDistribute,
    };
}

export type CanvasAlignmentHandlers = ReturnType<typeof useCanvasAlignment>;
