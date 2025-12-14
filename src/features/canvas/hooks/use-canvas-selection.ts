import { useState, useCallback } from 'react';
import { CanvasItem } from '@/types/canvas';
import { useCanvasStore } from '@/stores/canvasStore';

/**
 * Hook to manage selected items on the canvas
 */
export function useCanvasSelection() {
    const [selectedItems, setSelectedItems] = useState<CanvasItem[]>([]);
    const clearSelection = useCanvasStore((state) => state.clearSelection);

    const handleSelectionChange = useCallback((items: CanvasItem[]) => {
        setSelectedItems(items);
        // Sync with global store if needed
        // In this codebase, it seems local state drives the UI often
        // But we might want to update the store too
        if (items.length === 0) {
            clearSelection();
        }
    }, [clearSelection]);

    const selectItem = useCallback((item: CanvasItem, multiSelect: boolean) => {
        if (multiSelect) {
            setSelectedItems((prev) => {
                const exists = prev.find((i) => i.id === item.id);
                if (exists) {
                    return prev.filter((i) => i.id !== item.id);
                }
                return [...prev, item];
            });
        } else {
            setSelectedItems([item]);
        }
    }, []);

    const clearLocalSelection = useCallback(() => {
        setSelectedItems([]);
        clearSelection();
    }, [clearSelection]);

    return {
        selectedItems,
        setSelectedItems, // For direct access if needed
        handleSelectionChange,
        selectItem,
        clearSelection: clearLocalSelection,
        hasSelection: selectedItems.length > 0,
        selectedCount: selectedItems.length,
        singleSelectedItem: selectedItems.length === 1 ? selectedItems[0] : null,
    };
}
