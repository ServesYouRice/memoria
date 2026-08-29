import type { ViewportParams } from "@/lib/hooks/use-canvas-items";
import { RESOURCE_BUDGETS } from "@/lib/policy/resource-budgets";

export interface CanvasViewportState {
  zoom: number;
  x: number;
  y: number;
}

export function canvasViewportStorageKey(canvasId: string): string {
  return `canvas:${canvasId}:viewport`;
}

export function readCanvasViewport(
  storage: Pick<Storage, "getItem" | "removeItem">,
  canvasId: string,
  fallback: CanvasViewportState,
): CanvasViewportState {
  try {
    const stored = storage.getItem(canvasViewportStorageKey(canvasId));
    if (!stored) return fallback;
    const value = JSON.parse(stored) as Partial<CanvasViewportState>;
    return {
      zoom: typeof value.zoom === "number" ? value.zoom : fallback.zoom,
      x: typeof value.x === "number" ? value.x : fallback.x,
      y: typeof value.y === "number" ? value.y : fallback.y,
    };
  } catch {
    try {
      storage.removeItem(canvasViewportStorageKey(canvasId));
    } catch {
      // Storage can be disabled; callers always retain the server fallback.
    }
    return fallback;
  }
}

export function writeCanvasViewport(
  storage: Pick<Storage, "setItem">,
  canvasId: string,
  value: CanvasViewportState,
): void {
  try {
    storage.setItem(canvasViewportStorageKey(canvasId), JSON.stringify(value));
  } catch {
    // Viewport storage is best-effort and must never interrupt a gesture.
  }
}

export function calculateViewportWindow(input: {
  zoom: number;
  position: { x: number; y: number };
  size: { width: number; height: number };
  tags?: string[];
}): ViewportParams {
  const safeZoom = Math.max(0.1, input.zoom);
  const visibleWidth = input.size.width / safeZoom;
  const visibleHeight = input.size.height / safeZoom;
  const tile = RESOURCE_BUDGETS.canvas.viewportTilePixels;
  const minX = -input.position.x / safeZoom - visibleWidth * 0.5;
  const minY = -input.position.y / safeZoom - visibleHeight * 0.5;
  const maxX = -input.position.x / safeZoom + visibleWidth * 1.5;
  const maxY = -input.position.y / safeZoom + visibleHeight * 1.5;
  return {
    minX: Math.floor(minX / tile) * tile,
    minY: Math.floor(minY / tile) * tile,
    maxX: Math.ceil(maxX / tile) * tile,
    maxY: Math.ceil(maxY / tile) * tile,
    limit: RESOURCE_BUDGETS.canvas.viewportPageItems,
    tags: [...(input.tags || [])].sort(),
  };
}
