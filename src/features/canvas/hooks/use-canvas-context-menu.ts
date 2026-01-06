'use client';

import { useState, useCallback } from 'react';
import { type CanvasItem } from '@/types/canvas';

export interface ContextMenuPosition {
    x: number;
    y: number;
    itemId: string;
}

interface UseCanvasContextMenuOptions {
    selectedItemId: string | null;
    allItems: CanvasItem[];
    canvasId: string;
    createItem: (data: Partial<CanvasItem> & { canvasId: string }) => Promise<CanvasItem>;
    deleteItem: (data: { itemId: string; version: number }) => Promise<void>;
    setSelectedItemId: (id: string | null) => void;
    openComments: (itemId: string) => void;
}

/**
 * Canvas Context Menu Hook
 * 
 * Manages right-click context menu state and actions.
 */
export function useCanvasContextMenu({
    selectedItemId: _selectedItemId,
    allItems,
    canvasId,
    createItem,
    deleteItem,
    setSelectedItemId,
    openComments,
}: UseCanvasContextMenuOptions) {
    const [contextMenuPosition, setContextMenuPosition] = useState<ContextMenuPosition | null>(null);

    const handleContextMenu = useCallback((e: React.MouseEvent | MouseEvent, itemId: string) => {
        e.preventDefault();
        setContextMenuPosition({
            x: 'clientX' in e ? e.clientX : 0,
            y: 'clientY' in e ? e.clientY : 0,
            itemId,
        });
        setSelectedItemId(itemId);
    }, [setSelectedItemId]);

    const closeContextMenu = useCallback(() => {
        setContextMenuPosition(null);
    }, []);

    const handleDeleteFromMenu = useCallback(async () => {
        if (!contextMenuPosition) return;
        const item = allItems.find(i => i.id === contextMenuPosition.itemId);
        if (item) {
            try {
                await deleteItem({ itemId: item.id, version: item.version });
                setSelectedItemId(null);
            } catch (err) {
                console.error('Failed to delete item:', err);
            }
        }
        closeContextMenu();
    }, [contextMenuPosition, allItems, deleteItem, setSelectedItemId, closeContextMenu]);

    const handleDuplicateFromMenu = useCallback(async () => {
        if (!contextMenuPosition) return;
        const item = allItems.find(i => i.id === contextMenuPosition.itemId);
        if (item) {
            try {
                await createItem({
                    canvasId,
                    type: item.type,
                    positionX: item.positionX + 20,
                    positionY: item.positionY + 20,
                    width: item.width,
                    height: item.height,
                    zIndex: item.zIndex,
                    content: item.content,
                    tags: item.tags || [],
                });
            } catch (err) {
                console.error('Failed to duplicate item:', err);
            }
        }
        closeContextMenu();
    }, [contextMenuPosition, allItems, canvasId, createItem, closeContextMenu]);

    const handleCopyFromMenu = useCallback(() => {
        if (!contextMenuPosition) return;
        const item = allItems.find(i => i.id === contextMenuPosition.itemId);
        if (item) {
            const copyData = {
                type: item.type,
                content: item.content,
                width: item.width,
                height: item.height,
            };
            navigator.clipboard.writeText(JSON.stringify(copyData));
        }
        closeContextMenu();
    }, [contextMenuPosition, allItems, closeContextMenu]);

    const handleOpenCommentsFromMenu = useCallback(() => {
        if (!contextMenuPosition) return;
        openComments(contextMenuPosition.itemId);
        closeContextMenu();
    }, [contextMenuPosition, openComments, closeContextMenu]);

    return {
        contextMenuPosition,
        setContextMenuPosition,
        handleContextMenu,
        closeContextMenu,
        handleDeleteFromMenu,
        handleDuplicateFromMenu,
        handleCopyFromMenu,
        handleOpenCommentsFromMenu,
    };
}

export type ContextMenuHandlers = ReturnType<typeof useCanvasContextMenu>;
