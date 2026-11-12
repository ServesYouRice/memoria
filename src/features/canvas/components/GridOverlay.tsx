/**
 * Grid Overlay Component
 * Renders a visible grid on the canvas for alignment
 */

import React from "react";
import { Layer, Line, Shape } from "react-konva";
import { EXPORT_EXCLUDE_NAME } from "@/lib/export/export-utils";
import { CANVAS_PALETTE } from "@/features/canvas/lib/canvas-palette";

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
  stroke = CANVAS_PALETTE.light.grid,
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

  return (
    <Layer name={EXPORT_EXCLUDE_NAME} listening={false}>
      {lines}
    </Layer>
  );
}

/** Dots are never drawn closer together than this on screen. */
export const MIN_DOT_SCREEN_SPACING_PX = 16;
/** Dot radius on screen, whatever the zoom. */
const DOT_SCREEN_RADIUS_PX = 1.2;

/**
 * IMP-085: the calm default background, faint dots on the snap positions. One
 * Konva shape draws every dot in a single path, so the cost stays at one node.
 * Shown when the grid lines are off; like the grid, it is left out of exports.
 */
export function DotOverlay({
  width,
  height,
  gridSize,
  visible,
  offset = { x: 0, y: 0 },
  zoom = 1,
  stroke = CANVAS_PALETTE.light.dot,
}: GridOverlayProps) {
  if (!visible || !(gridSize > 0) || !(zoom > 0)) return null;
  let step = gridSize;
  while (step * zoom < MIN_DOT_SCREEN_SPACING_PX) step *= 2;
  const startX = Math.floor(offset.x / step) * step;
  const startY = Math.floor(offset.y / step) * step;
  const endX = startX + width / zoom + step;
  const endY = startY + height / zoom + step;
  const radius = DOT_SCREEN_RADIUS_PX / zoom;

  return (
    <Layer name={EXPORT_EXCLUDE_NAME} listening={false}>
      <Shape
        listening={false}
        perfectDrawEnabled={false}
        fill={stroke}
        sceneFunc={(context, shape) => {
          context.beginPath();
          for (let x = startX; x <= endX; x += step) {
            for (let y = startY; y <= endY; y += step) {
              context.moveTo(x + radius, y);
              context.arc(x, y, radius, 0, Math.PI * 2);
            }
          }
          context.fillShape(shape);
        }}
      />
    </Layer>
  );
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
