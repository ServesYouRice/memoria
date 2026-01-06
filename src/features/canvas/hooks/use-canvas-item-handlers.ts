'use client';

import { useCallback } from 'react';
import { type CanvasItem } from '@/types/canvas';

interface Command {
    type: string;
    description: string;
    execute: () => Promise<void>;
    undo: () => Promise<void>;
}

interface UseCanvasItemHandlersOptions {
    canvasId: string;
    allItems: CanvasItem[];
    selectedItemIds: Set<string>;
    selectedItemId: string | null;
    setSelectedItemIds: (ids: Set<string>) => void;
    setSelectedItemId: (id: string | null) => void;
    createItem: (data: Partial<CanvasItem> & { canvasId: string }) => Promise<CanvasItem>;
    deleteItem: (data: { itemId: string; version: number }) => Promise<void>;
    addCommand: (command: Command) => void;
}

/**
 * Canvas Item Handlers Hook
 * 
 * Provides delete, copy, paste, duplicate, and select all operations
 * with undo/redo support via command pattern.
 */
export function useCanvasItemHandlers({
    canvasId,
    allItems,
    selectedItemIds,
    selectedItemId,
    setSelectedItemIds,
    setSelectedItemId,
    createItem,
    deleteItem,
    addCommand,
}: UseCanvasItemHandlersOptions) {

    const handleDelete = useCallback(async () => {
        if (selectedItemIds.size > 0) {
            try {
                const itemsToDelete = allItems.filter((item) => selectedItemIds.has(item.id));
                const deleteCommand: Command = {
                    type: 'delete',
                    description: `Delete ${itemsToDelete.length} items`,
                    execute: async () => {
                        await Promise.all(
                            itemsToDelete.map((item) =>
                                deleteItem({ itemId: item.id, version: item.version })
                            )
                        );
                    },
                    undo: async () => {
                        await Promise.all(
                            itemsToDelete.map((item) =>
                                createItem({
                                    canvasId,
                                    type: item.type,
                                    positionX: item.positionX,
                                    positionY: item.positionY,
                                    width: item.width,
                                    height: item.height,
                                    zIndex: item.zIndex,
                                    content: item.content,
                                    tags: item.tags || [],
                                })
                            )
                        );
                    },
                };
                await deleteCommand.execute();
                addCommand(deleteCommand);
                setSelectedItemIds(new Set());
            } catch (err) {
                console.error('Failed to bulk delete items:', err);
            }
        } else if (selectedItemId) {
            const selectedItem = allItems.find((item) => item.id === selectedItemId);
            if (selectedItem) {
                try {
                    const deleteCommand: Command = {
                        type: 'delete',
                        description: `Delete ${selectedItem.type}`,
                        execute: async () => {
                            await deleteItem({ itemId: selectedItem.id, version: selectedItem.version });
                        },
                        undo: async () => {
                            await createItem({
                                canvasId,
                                type: selectedItem.type,
                                positionX: selectedItem.positionX,
                                positionY: selectedItem.positionY,
                                width: selectedItem.width,
                                height: selectedItem.height,
                                zIndex: selectedItem.zIndex,
                                content: selectedItem.content,
                                tags: selectedItem.tags || [],
                            });
                        },
                    };
                    await deleteCommand.execute();
                    addCommand(deleteCommand);
                    setSelectedItemId(null);
                } catch (err) {
                    console.error('Failed to delete item:', err);
                }
            }
        }
    }, [canvasId, allItems, selectedItemIds, selectedItemId, setSelectedItemIds, setSelectedItemId, createItem, deleteItem, addCommand]);

    const handleCopy = useCallback(() => {
        if (!selectedItemId) return;
        const selectedItem = allItems.find((item) => item.id === selectedItemId);
        if (selectedItem) {
            const copyData = {
                type: selectedItem.type,
                content: selectedItem.content,
                width: selectedItem.width,
                height: selectedItem.height,
            };
            navigator.clipboard.writeText(JSON.stringify(copyData));
        }
    }, [allItems, selectedItemId]);

    const handlePaste = useCallback(async () => {
        try {
            const text = await navigator.clipboard.readText();
            const data = JSON.parse(text);
            if (data.type && data.content) {
                await createItem({
                    canvasId,
                    type: data.type,
                    positionX: 100 + Math.random() * 50,
                    positionY: 100 + Math.random() * 50,
                    width: data.width || 200,
                    height: data.height || 150,
                    zIndex: 1,
                    content: data.content,
                    tags: [],
                });
            }
        } catch {
            // Silent fail - clipboard may not contain valid data
        }
    }, [canvasId, createItem]);

    const handleSelectAll = useCallback(() => {
        const allIds = new Set(allItems.map((item) => item.id));
        setSelectedItemIds(allIds);
        setSelectedItemId(null);
    }, [allItems, setSelectedItemIds, setSelectedItemId]);

    const handleDuplicate = useCallback(async () => {
        if (!selectedItemId) return;
        const selectedItem = allItems.find((item) => item.id === selectedItemId);
        if (selectedItem) {
            try {
                await createItem({
                    canvasId,
                    type: selectedItem.type,
                    positionX: selectedItem.positionX + 20,
                    positionY: selectedItem.positionY + 20,
                    width: selectedItem.width,
                    height: selectedItem.height,
                    zIndex: selectedItem.zIndex,
                    content: selectedItem.content,
                    tags: selectedItem.tags || [],
                });
            } catch (err) {
                console.error('Failed to duplicate item:', err);
            }
        }
    }, [canvasId, allItems, selectedItemId, createItem]);

    const handleEscape = useCallback(() => {
        setSelectedItemId(null);
        setSelectedItemIds(new Set());
    }, [setSelectedItemId, setSelectedItemIds]);

    return {
        handleDelete,
        handleCopy,
        handlePaste,
        handleSelectAll,
        handleDuplicate,
        handleEscape,
    };
}

export type CanvasItemHandlers = ReturnType<typeof useCanvasItemHandlers>;
