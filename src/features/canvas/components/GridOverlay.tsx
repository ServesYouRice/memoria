/**
 * Grid Overlay Component
 * Renders a visible grid on the canvas for alignment
 */

import React from "react";
import { Layer, Line } from "react-konva";

export interface GridOverlayProps {
  width: number;
  height: number;
  gridSize: number;
  visible: boolean;
  /**
   * World-space coordinate of the viewport's top-left corner
   * (`-position / zoom`). The overlay sits inside the transformed Stage, so
   * its lines are drawn in world coordinates.
   */
  offset?: { x: number; y: number };
  zoom?: number;
  /** Line color; defaults to a light-mode grey. Pass a theme value for dark mode. */
  stroke?: string;
}

/** Grid lines are never drawn closer together than this on screen. */
export const MIN_GRID_SCREEN_SPACING_PX = 10;

/**
 * Visual grid step: `gridSize` doubled until lines are at least
 * MIN_GRID_SCREEN_SPACING_PX apart on screen, so every line stays on a snap
 * position and the line count stays bounded at low zoom.
 */
export function gridStepForZoom(gridSize: number, zoom: number): number {
  let step = gridSize;
  if (!(step > 0) || !(zoom > 0)) return step;
  while (step * zoom < MIN_GRID_SCREEN_SPACING_PX) step *= 2;
  return step;
}

export function GridOverlay({
  width,
  height,
  gridSize,
  visible,
  offset = { x: 0, y: 0 },
  zoom = 1,
  stroke = "#e0e0e0",
}: GridOverlayProps) {
  if (!visible) return null;

  const lines: React.ReactElement[] = [];

  const adjustedGridSize = gridStepForZoom(gridSize, zoom);

  // `offset` is already the viewport's world origin.
  const startX = Math.floor(offset.x / adjustedGridSize) * adjustedGridSize;
  const startY = Math.floor(offset.y / adjustedGridSize) * adjustedGridSize;

  const endX = startX + width / zoom + adjustedGridSize;
  const endY = startY + height / zoom + adjustedGridSize;

  // Vertical lines
  for (let x = startX; x <= endX; x += adjustedGridSize) {
    lines.push(
      <Line
        key={`v-${x}`}
        points={[x, startY, x, endY]}
        stroke={stroke}
        strokeWidth={1 / zoom}
        listening={false}
      />,
    );
  }

  // Horizontal lines
  for (let y = startY; y <= endY; y += adjustedGridSize) {
    lines.push(
      <Line
        key={`h-${y}`}
        points={[startX, y, endX, y]}
        stroke={stroke}
        strokeWidth={1 / zoom}
        listening={false}
      />,
    );
  }

  return <Layer listening={false}>{lines}</Layer>;
}

/**
 * Utility function to snap a value to the nearest grid position
 */
export function snapToGrid(value: number, gridSize: number): number {
  return Math.round(value / gridSize) * gridSize;
}

/**
 * Utility function to snap a position to the grid
 */
export function snapPositionToGrid(
  position: { x: number; y: number },
  gridSize: number,
): { x: number; y: number } {
  return {
    x: snapToGrid(position.x, gridSize),
    y: snapToGrid(position.y, gridSize),
  };
}
