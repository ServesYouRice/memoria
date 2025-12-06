/**
 * Canvas Clipboard Operations
 *
 * Copy, cut, paste for canvas items.
 *
 * @module lib/canvas/clipboard
 */

export interface ClipboardItem {
    id: string;
    type: string;
    x: number;
    y: number;
    width: number;
    height: number;
    content: unknown;
    tags?: string[];
}

export interface CanvasClipboard {
    items: ClipboardItem[];
    operation: 'copy' | 'cut';
    sourceCanvasId?: string;
    timestamp: number;
}

// In-memory clipboard
let clipboard: CanvasClipboard | null = null;

/**
 * Copy items to clipboard
 */
export function copyItems(items: ClipboardItem[], sourceCanvasId?: string): void {
    clipboard = {
        items: items.map((item) => ({ ...item })),
        operation: 'copy',
        sourceCanvasId,
        timestamp: Date.now(),
    };
}

/**
 * Cut items to clipboard
 */
export function cutItems(items: ClipboardItem[], sourceCanvasId?: string): void {
    clipboard = {
        items: items.map((item) => ({ ...item })),
        operation: 'cut',
        sourceCanvasId,
        timestamp: Date.now(),
    };
}

/**
 * Get items from clipboard
 */
export function getClipboardItems(): ClipboardItem[] | null {
    return clipboard?.items ?? null;
}

/**
 * Check if clipboard has items
 */
export function hasClipboardItems(): boolean {
    return clipboard !== null && clipboard.items.length > 0;
}

/**
 * Get clipboard operation type
 */
export function getClipboardOperation(): 'copy' | 'cut' | null {
    return clipboard?.operation ?? null;
}

/**
 * Clear clipboard
 */
export function clearClipboard(): void {
    clipboard = null;
}

/**
 * Paste items at position with offset
 */
export function pasteItemsAtPosition(
    targetX: number,
    targetY: number,
    offset = { x: 20, y: 20 }
): ClipboardItem[] | null {
    if (!clipboard) return null;

    const items = clipboard.items;
    if (items.length === 0) return null;

    // Find bounding box of copied items
    let minX = Infinity;
    let minY = Infinity;

    for (const item of items) {
        minX = Math.min(minX, item.x);
        minY = Math.min(minY, item.y);
    }

    // Calculate offset from original position
    const deltaX = targetX - minX + offset.x;
    const deltaY = targetY - minY + offset.y;

    // Create new items with new IDs and positions
    return items.map((item) => ({
        ...item,
        id: crypto.randomUUID(),
        x: item.x + deltaX,
        y: item.y + deltaY,
    }));
}

/**
 * Duplicate items in place with offset
 */
export function duplicateItems(
    items: ClipboardItem[],
    offset = { x: 20, y: 20 }
): ClipboardItem[] {
    return items.map((item) => ({
        ...item,
        id: crypto.randomUUID(),
        x: item.x + offset.x,
        y: item.y + offset.y,
    }));
}

/**
 * Serialize clipboard for external sharing
 */
export function serializeClipboard(): string | null {
    if (!clipboard) return null;
    return JSON.stringify(clipboard);
}

/**
 * Deserialize clipboard from external source
 */
export function deserializeClipboard(data: string): boolean {
    try {
        const parsed = JSON.parse(data);
        if (parsed.items && Array.isArray(parsed.items)) {
            clipboard = parsed;
            return true;
        }
        return false;
    } catch {
        return false;
    }
}
