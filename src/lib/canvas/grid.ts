/**
 * Canvas Grid
 *
 * Grid rendering and snapping utilities.
 *
 * @module lib/canvas/grid
 */

export interface GridConfig {
    size: number;
    color: string;
    visible: boolean;
    snap: boolean;
    majorLineInterval: number;
    majorLineColor: string;
}

export const DEFAULT_GRID_CONFIG: GridConfig = {
    size: 20,
    color: 'rgba(200, 200, 200, 0.3)',
    visible: true,
    snap: true,
    majorLineInterval: 5,
    majorLineColor: 'rgba(150, 150, 150, 0.5)',
};

/**
 * Snap a value to the grid
 */
export function snapToGridValue(value: number, gridSize: number): number {
    return Math.round(value / gridSize) * gridSize;
}

/**
 * Snap a position to the grid
 */
export function snapPositionToGrid(
    x: number,
    y: number,
    gridSize: number
): { x: number; y: number } {
    return {
        x: snapToGridValue(x, gridSize),
        y: snapToGridValue(y, gridSize),
    };
}

/**
 * Generate grid lines for rendering
 */
export function generateGridLines(
    viewportX: number,
    viewportY: number,
    canvasWidth: number,
    canvasHeight: number,
    zoom: number,
    config: GridConfig
): { minor: Array<{ x1: number; y1: number; x2: number; y2: number }>; major: Array<{ x1: number; y1: number; x2: number; y2: number }> } {
    const minor: Array<{ x1: number; y1: number; x2: number; y2: number }> = [];
    const major: Array<{ x1: number; y1: number; x2: number; y2: number }> = [];

    const scaledSize = config.size * zoom;

    // Don't render grid if too small
    if (scaledSize < 5) return { minor, major };

    const startX = Math.floor(-viewportX / scaledSize) * scaledSize + viewportX;
    const startY = Math.floor(-viewportY / scaledSize) * scaledSize + viewportY;

    // Vertical lines
    for (let x = startX; x < canvasWidth; x += scaledSize) {
        const gridIndex = Math.round((x - viewportX) / scaledSize);
        const line = { x1: x, y1: 0, x2: x, y2: canvasHeight };

        if (gridIndex % config.majorLineInterval === 0) {
            major.push(line);
        } else {
            minor.push(line);
        }
    }

    // Horizontal lines
    for (let y = startY; y < canvasHeight; y += scaledSize) {
        const gridIndex = Math.round((y - viewportY) / scaledSize);
        const line = { x1: 0, y1: y, x2: canvasWidth, y2: y };

        if (gridIndex % config.majorLineInterval === 0) {
            major.push(line);
        } else {
            minor.push(line);
        }
    }

    return { minor, major };
}

/**
 * Generate dot grid pattern
 */
export function generateDotGrid(
    viewportX: number,
    viewportY: number,
    canvasWidth: number,
    canvasHeight: number,
    zoom: number,
    config: GridConfig
): Array<{ x: number; y: number; major: boolean }> {
    const dots: Array<{ x: number; y: number; major: boolean }> = [];

    const scaledSize = config.size * zoom;

    if (scaledSize < 10) return dots;

    const startX = Math.floor(-viewportX / scaledSize) * scaledSize + viewportX;
    const startY = Math.floor(-viewportY / scaledSize) * scaledSize + viewportY;

    for (let x = startX; x < canvasWidth; x += scaledSize) {
        for (let y = startY; y < canvasHeight; y += scaledSize) {
            const gridIndexX = Math.round((x - viewportX) / scaledSize);
            const gridIndexY = Math.round((y - viewportY) / scaledSize);
            const major = gridIndexX % config.majorLineInterval === 0 &&
                gridIndexY % config.majorLineInterval === 0;
            dots.push({ x, y, major });
        }
    }

    return dots;
}
