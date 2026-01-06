/**
 * Virtual Rendering Hook for Large Canvases
 *
 * For canvases with 100+ items, only renders items that are visible in the viewport.
 * This significantly improves performance by reducing DOM nodes and Konva shapes.
 *
 * @module lib/hooks/use-virtual-items
 *
 * @example
 * ```tsx
 * const visibleItems = useVirtualItems(items, {
 *   viewport: { x: panX, y: panY, width: 1920, height: 1080 },
 *   zoom: currentZoom,
 *   padding: 100, // Extra padding around viewport
 * });
 *
 * return visibleItems.map(item => <CanvasItem key={item.id} {...item} />);
 * ```
 */

import { useMemo } from 'react';

export interface Viewport {
    x: number;
    y: number;
    width: number;
    height: number;
}

export interface VirtualItem {
    id: string;
    x: number;
    y: number;
    width: number;
    height: number;
    [key: string]: unknown;
}

export interface UseVirtualItemsOptions {
    /** Current viewport bounds */
    viewport: Viewport;
    /** Current zoom level */
    zoom: number;
    /** Extra padding around viewport to preload nearby items (default: 200) */
    padding?: number;
    /** Minimum items before enabling virtualization (default: 50) */
    threshold?: number;
}

/**
 * Check if an item is within the viewport bounds (with padding)
 */
function isInViewport(
    item: VirtualItem,
    viewport: Viewport,
    zoom: number,
    padding: number
): boolean {
    // Calculate adjusted viewport bounds based on zoom and pan
    const viewLeft = -viewport.x / zoom - padding;
    const viewTop = -viewport.y / zoom - padding;
    const viewRight = viewLeft + viewport.width / zoom + padding * 2;
    const viewBottom = viewTop + viewport.height / zoom + padding * 2;

    // Item bounds
    const itemRight = item.x + item.width;
    const itemBottom = item.y + item.height;

    // Check for intersection
    return !(
        item.x > viewRight ||
        itemRight < viewLeft ||
        item.y > viewBottom ||
        itemBottom < viewTop
    );
}

/**
 * Filter items to only those visible in the current viewport
 */
export function useVirtualItems<T extends VirtualItem>(
    items: T[],
    options: UseVirtualItemsOptions
): T[] {
    const { viewport, zoom, padding = 200, threshold = 50 } = options;
    const { x, y, width, height } = viewport;

    return useMemo(() => {
        // Skip virtualization for small item counts
        if (items.length < threshold) {
            return items;
        }

        // Filter to only visible items
        return items.filter((item) => isInViewport(item, { x, y, width, height }, zoom, padding));
    }, [items, x, y, width, height, zoom, padding, threshold]);
}

/**
 * Get statistics about virtualization
 */
export function useVirtualStats<T extends VirtualItem>(
    items: T[],
    visibleItems: T[]
): { total: number; visible: number; culled: number; percentage: number } {
    return useMemo(() => {
        const total = items.length;
        const visible = visibleItems.length;
        const culled = total - visible;
        const percentage = total > 0 ? Math.round((culled / total) * 100) : 0;

        return { total, visible, culled, percentage };
    }, [items.length, visibleItems.length]);
}
