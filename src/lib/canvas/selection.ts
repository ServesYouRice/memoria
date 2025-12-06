/**
 * Canvas Selection Utilities
 *
 * Helpers for multi-selection, lasso selection, and selection operations.
 *
 * @module lib/canvas/selection
 */

import type { Point, Rect } from './position';

export interface SelectableItem {
    id: string;
    x: number;
    y: number;
    width: number;
    height: number;
}

/**
 * Get items within a selection rectangle
 */
export function getItemsInRect<T extends SelectableItem>(
    items: T[],
    selectionRect: Rect,
    mode: 'intersect' | 'contain' = 'intersect'
): T[] {
    return items.filter((item) => {
        const itemRect: Rect = {
            x: item.x,
            y: item.y,
            width: item.width,
            height: item.height,
        };

        if (mode === 'contain') {
            return isRectContained(itemRect, selectionRect);
        }
        return rectsIntersect(itemRect, selectionRect);
    });
}

/**
 * Check if rect A is fully contained in rect B
 */
function isRectContained(a: Rect, b: Rect): boolean {
    return (
        a.x >= b.x &&
        a.y >= b.y &&
        a.x + a.width <= b.x + b.width &&
        a.y + a.height <= b.y + b.height
    );
}

/**
 * Check if two rects intersect
 */
function rectsIntersect(a: Rect, b: Rect): boolean {
    return !(
        a.x + a.width < b.x ||
        b.x + b.width < a.x ||
        a.y + a.height < b.y ||
        b.y + b.height < a.y
    );
}

/**
 * Create selection rect from two points (drag start and current)
 */
export function createSelectionRect(start: Point, current: Point): Rect {
    return {
        x: Math.min(start.x, current.x),
        y: Math.min(start.y, current.y),
        width: Math.abs(current.x - start.x),
        height: Math.abs(current.y - start.y),
    };
}

/**
 * Toggle item in selection
 */
export function toggleSelection(selectedIds: string[], itemId: string): string[] {
    if (selectedIds.includes(itemId)) {
        return selectedIds.filter((id) => id !== itemId);
    }
    return [...selectedIds, itemId];
}

/**
 * Add items to selection
 */
export function addToSelection(selectedIds: string[], newIds: string[]): string[] {
    const set = new Set([...selectedIds, ...newIds]);
    return Array.from(set);
}

/**
 * Remove items from selection
 */
export function removeFromSelection(selectedIds: string[], removeIds: string[]): string[] {
    const removeSet = new Set(removeIds);
    return selectedIds.filter((id) => !removeSet.has(id));
}

/**
 * Select all items
 */
export function selectAll<T extends { id: string }>(items: T[]): string[] {
    return items.map((item) => item.id);
}

/**
 * Invert selection
 */
export function invertSelection<T extends { id: string }>(
    items: T[],
    selectedIds: string[]
): string[] {
    const selected = new Set(selectedIds);
    return items.filter((item) => !selected.has(item.id)).map((item) => item.id);
}

/**
 * Get selected items
 */
export function getSelectedItems<T extends { id: string }>(
    items: T[],
    selectedIds: string[]
): T[] {
    const selected = new Set(selectedIds);
    return items.filter((item) => selected.has(item.id));
}

/**
 * Check if any items are selected
 */
export function hasSelection(selectedIds: string[]): boolean {
    return selectedIds.length > 0;
}

/**
 * Check if multiple items are selected
 */
export function hasMultipleSelection(selectedIds: string[]): boolean {
    return selectedIds.length > 1;
}
