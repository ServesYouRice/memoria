/**
 * Canvas Position Utilities
 *
 * Helpers for canvas item positioning, snapping, and alignment.
 *
 * @module lib/canvas/position
 */

export interface Point {
    x: number;
    y: number;
}

export interface Rect {
    x: number;
    y: number;
    width: number;
    height: number;
}

export interface Bounds {
    left: number;
    right: number;
    top: number;
    bottom: number;
}

/**
 * Snap position to grid
 */
export function snapToGrid(point: Point, gridSize: number): Point {
    return {
        x: Math.round(point.x / gridSize) * gridSize,
        y: Math.round(point.y / gridSize) * gridSize,
    };
}

/**
 * Get center of a rectangle
 */
export function getCenter(rect: Rect): Point {
    return {
        x: rect.x + rect.width / 2,
        y: rect.y + rect.height / 2,
    };
}

/**
 * Get bounds from rectangle
 */
export function getBounds(rect: Rect): Bounds {
    return {
        left: rect.x,
        right: rect.x + rect.width,
        top: rect.y,
        bottom: rect.y + rect.height,
    };
}

/**
 * Check if two rectangles overlap
 */
export function rectsOverlap(a: Rect, b: Rect): boolean {
    return !(
        a.x + a.width < b.x ||
        b.x + b.width < a.x ||
        a.y + a.height < b.y ||
        b.y + b.height < a.y
    );
}

/**
 * Check if point is inside rectangle
 */
export function pointInRect(point: Point, rect: Rect): boolean {
    return (
        point.x >= rect.x &&
        point.x <= rect.x + rect.width &&
        point.y >= rect.y &&
        point.y <= rect.y + rect.height
    );
}

/**
 * Get bounding box of multiple rectangles
 */
export function getBoundingBox(rects: Rect[]): Rect | null {
    if (rects.length === 0) return null;

    let left = Infinity;
    let top = Infinity;
    let right = -Infinity;
    let bottom = -Infinity;

    for (const rect of rects) {
        left = Math.min(left, rect.x);
        top = Math.min(top, rect.y);
        right = Math.max(right, rect.x + rect.width);
        bottom = Math.max(bottom, rect.y + rect.height);
    }

    return {
        x: left,
        y: top,
        width: right - left,
        height: bottom - top,
    };
}

/**
 * Distribute items horizontally with equal spacing
 */
export function distributeHorizontally(rects: Rect[], spacing: number): Rect[] {
    if (rects.length < 2) return rects;

    const sorted = [...rects].sort((a, b) => a.x - b.x);
    const result: Rect[] = [];
    let currentX = sorted[0].x;

    for (const rect of sorted) {
        result.push({ ...rect, x: currentX });
        currentX += rect.width + spacing;
    }

    return result;
}

/**
 * Distribute items vertically with equal spacing
 */
export function distributeVertically(rects: Rect[], spacing: number): Rect[] {
    if (rects.length < 2) return rects;

    const sorted = [...rects].sort((a, b) => a.y - b.y);
    const result: Rect[] = [];
    let currentY = sorted[0].y;

    for (const rect of sorted) {
        result.push({ ...rect, y: currentY });
        currentY += rect.height + spacing;
    }

    return result;
}

/**
 * Align items to the left
 */
export function alignLeft(rects: Rect[]): Rect[] {
    if (rects.length === 0) return rects;
    const minX = Math.min(...rects.map((r) => r.x));
    return rects.map((rect) => ({ ...rect, x: minX }));
}

/**
 * Align items to the right
 */
export function alignRight(rects: Rect[]): Rect[] {
    if (rects.length === 0) return rects;
    const maxRight = Math.max(...rects.map((r) => r.x + r.width));
    return rects.map((rect) => ({ ...rect, x: maxRight - rect.width }));
}

/**
 * Align items to the top
 */
export function alignTop(rects: Rect[]): Rect[] {
    if (rects.length === 0) return rects;
    const minY = Math.min(...rects.map((r) => r.y));
    return rects.map((rect) => ({ ...rect, y: minY }));
}

/**
 * Align items to the bottom
 */
export function alignBottom(rects: Rect[]): Rect[] {
    if (rects.length === 0) return rects;
    const maxBottom = Math.max(...rects.map((r) => r.y + r.height));
    return rects.map((rect) => ({ ...rect, y: maxBottom - rect.height }));
}

/**
 * Center items horizontally
 */
export function centerHorizontally(rects: Rect[]): Rect[] {
    if (rects.length === 0) return rects;
    const bbox = getBoundingBox(rects);
    if (!bbox) return rects;
    const centerX = bbox.x + bbox.width / 2;
    return rects.map((rect) => ({ ...rect, x: centerX - rect.width / 2 }));
}

/**
 * Center items vertically
 */
export function centerVertically(rects: Rect[]): Rect[] {
    if (rects.length === 0) return rects;
    const bbox = getBoundingBox(rects);
    if (!bbox) return rects;
    const centerY = bbox.y + bbox.height / 2;
    return rects.map((rect) => ({ ...rect, y: centerY - rect.height / 2 }));
}

/**
 * Calculate distance between two points
 */
export function distance(a: Point, b: Point): number {
    return Math.sqrt(Math.pow(b.x - a.x, 2) + Math.pow(b.y - a.y, 2));
}
