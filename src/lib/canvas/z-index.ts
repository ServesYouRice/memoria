/**
 * Canvas Z-Index Management
 *
 * Helpers for managing item layering and z-index operations.
 *
 * @module lib/canvas/z-index
 */

export interface ZIndexItem {
    id: string;
    zIndex: number;
}

/**
 * Bring item to front
 */
export function bringToFront<T extends ZIndexItem>(items: T[], itemId: string): T[] {
    const maxZ = Math.max(...items.map((i) => i.zIndex), 0);
    return items.map((item) =>
        item.id === itemId ? { ...item, zIndex: maxZ + 1 } : item
    );
}

/**
 * Send item to back
 */
export function sendToBack<T extends ZIndexItem>(items: T[], itemId: string): T[] {
    const minZ = Math.min(...items.map((i) => i.zIndex), 0);
    return items.map((item) =>
        item.id === itemId ? { ...item, zIndex: minZ - 1 } : item
    );
}

/**
 * Bring item forward one level
 */
export function bringForward<T extends ZIndexItem>(items: T[], itemId: string): T[] {
    const sorted = [...items].sort((a, b) => a.zIndex - b.zIndex);
    const itemIndex = sorted.findIndex((i) => i.id === itemId);

    if (itemIndex === -1 || itemIndex === sorted.length - 1) {
        return items;
    }

    const item = sorted[itemIndex];
    const nextItem = sorted[itemIndex + 1];

    return items.map((i) => {
        if (i.id === item.id) return { ...i, zIndex: nextItem.zIndex + 1 };
        return i;
    });
}

/**
 * Send item backward one level
 */
export function sendBackward<T extends ZIndexItem>(items: T[], itemId: string): T[] {
    const sorted = [...items].sort((a, b) => a.zIndex - b.zIndex);
    const itemIndex = sorted.findIndex((i) => i.id === itemId);

    if (itemIndex <= 0) {
        return items;
    }

    const item = sorted[itemIndex];
    const prevItem = sorted[itemIndex - 1];

    return items.map((i) => {
        if (i.id === item.id) return { ...i, zIndex: prevItem.zIndex - 1 };
        return i;
    });
}

/**
 * Normalize z-indices to start from 0
 */
export function normalizeZIndices<T extends ZIndexItem>(items: T[]): T[] {
    const sorted = [...items].sort((a, b) => a.zIndex - b.zIndex);
    return sorted.map((item, index) => ({ ...item, zIndex: index }));
}

/**
 * Get next available z-index
 */
export function getNextZIndex(items: ZIndexItem[]): number {
    if (items.length === 0) return 0;
    return Math.max(...items.map((i) => i.zIndex)) + 1;
}

/**
 * Reorder items by z-index
 */
export function reorderByZIndex<T extends ZIndexItem>(items: T[]): T[] {
    return [...items].sort((a, b) => a.zIndex - b.zIndex);
}
