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
  offset?: { x: number; y: number };
  zoom?: number;
  /** Line color; pass a theme-derived color so the grid works in dark mode */
  stroke?: string;
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

  // Calculate adjusted grid size based on zoom
  const adjustedGridSize = gridSize;

  // Calculate the starting positions based on offset
  const startX =
    Math.floor(-offset.x / zoom / adjustedGridSize) * adjustedGridSize;
  const startY =
    Math.floor(-offset.y / zoom / adjustedGridSize) * adjustedGridSize;

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
