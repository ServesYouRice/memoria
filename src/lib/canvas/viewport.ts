/**
 * Canvas Viewport
 *
 * Manages canvas viewport, zoom, and pan.
 *
 * @module lib/canvas/viewport
 */

export interface Viewport {
    x: number;
    y: number;
    zoom: number;
}

export interface ViewportBounds {
    minX: number;
    maxX: number;
    minY: number;
    maxY: number;
}

export const MIN_ZOOM = 0.1;
export const MAX_ZOOM = 5;
export const DEFAULT_ZOOM = 1;

/**
 * Create initial viewport
 */
export function createViewport(): Viewport {
    return { x: 0, y: 0, zoom: DEFAULT_ZOOM };
}

/**
 * Clamp zoom to valid range
 */
export function clampZoom(zoom: number): number {
    return Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, zoom));
}

/**
 * Zoom viewport at a specific point (for pinch-to-zoom)
 */
export function zoomAt(
    viewport: Viewport,
    newZoom: number,
    focusX: number,
    focusY: number
): Viewport {
    const clampedZoom = clampZoom(newZoom);
    const zoomFactor = clampedZoom / viewport.zoom;

    return {
        x: focusX - (focusX - viewport.x) * zoomFactor,
        y: focusY - (focusY - viewport.y) * zoomFactor,
        zoom: clampedZoom,
    };
}

/**
 * Zoom viewport towards center
 */
export function zoomToCenter(
    viewport: Viewport,
    newZoom: number,
    canvasWidth: number,
    canvasHeight: number
): Viewport {
    const centerX = canvasWidth / 2;
    const centerY = canvasHeight / 2;
    return zoomAt(viewport, newZoom, centerX, centerY);
}

/**
 * Pan viewport by delta
 */
export function panBy(viewport: Viewport, deltaX: number, deltaY: number): Viewport {
    return {
        ...viewport,
        x: viewport.x + deltaX,
        y: viewport.y + deltaY,
    };
}

/**
 * Pan viewport to specific position
 */
export function panTo(viewport: Viewport, x: number, y: number): Viewport {
    return { ...viewport, x, y };
}

/**
 * Convert screen coordinates to canvas coordinates
 */
export function screenToCanvas(
    viewport: Viewport,
    screenX: number,
    screenY: number
): { x: number; y: number } {
    return {
        x: (screenX - viewport.x) / viewport.zoom,
        y: (screenY - viewport.y) / viewport.zoom,
    };
}

/**
 * Convert canvas coordinates to screen coordinates
 */
export function canvasToScreen(
    viewport: Viewport,
    canvasX: number,
    canvasY: number
): { x: number; y: number } {
    return {
        x: canvasX * viewport.zoom + viewport.x,
        y: canvasY * viewport.zoom + viewport.y,
    };
}

/**
 * Fit viewport to show all items
 */
export function fitToContent(
    items: Array<{ x: number; y: number; width: number; height: number }>,
    canvasWidth: number,
    canvasHeight: number,
    padding = 50
): Viewport {
    if (items.length === 0) {
        return createViewport();
    }

    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;

    for (const item of items) {
        minX = Math.min(minX, item.x);
        minY = Math.min(minY, item.y);
        maxX = Math.max(maxX, item.x + item.width);
        maxY = Math.max(maxY, item.y + item.height);
    }

    const contentWidth = maxX - minX + padding * 2;
    const contentHeight = maxY - minY + padding * 2;

    const zoomX = canvasWidth / contentWidth;
    const zoomY = canvasHeight / contentHeight;
    const zoom = clampZoom(Math.min(zoomX, zoomY));

    const x = (canvasWidth - contentWidth * zoom) / 2 - (minX - padding) * zoom;
    const y = (canvasHeight - contentHeight * zoom) / 2 - (minY - padding) * zoom;

    return { x, y, zoom };
}

/**
 * Center viewport on a specific item
 */
export function centerOnItem(
    item: { x: number; y: number; width: number; height: number },
    canvasWidth: number,
    canvasHeight: number,
    zoom: number = DEFAULT_ZOOM
): Viewport {
    const centerX = item.x + item.width / 2;
    const centerY = item.y + item.height / 2;

    return {
        x: canvasWidth / 2 - centerX * zoom,
        y: canvasHeight / 2 - centerY * zoom,
        zoom,
    };
}

/**
 * Check if item is visible in viewport
 */
export function isItemVisible(
    item: { x: number; y: number; width: number; height: number },
    viewport: Viewport,
    canvasWidth: number,
    canvasHeight: number
): boolean {
    const screenPos = canvasToScreen(viewport, item.x, item.y);
    const screenWidth = item.width * viewport.zoom;
    const screenHeight = item.height * viewport.zoom;

    return !(
        screenPos.x + screenWidth < 0 ||
        screenPos.x > canvasWidth ||
        screenPos.y + screenHeight < 0 ||
        screenPos.y > canvasHeight
    );
}
