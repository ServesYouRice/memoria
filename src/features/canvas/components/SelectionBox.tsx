/**
 * SelectionBox Component
 *
 * Visual rectangle overlay for multi-select on canvas
 */

"use client";

import React from "react";
import { Rect } from "react-konva";
import { useCanvasPalette } from "@/features/canvas/lib/canvas-palette";

export interface SelectionBoxProps {
  x: number;
  y: number;
  width: number;
  height: number;
}

export function SelectionBox({ x, y, width, height }: SelectionBoxProps) {
  const palette = useCanvasPalette();
  return (
    <Rect
      x={x}
      y={y}
      width={width}
      height={height}
      fill={palette.selectionFill}
      stroke={palette.selection}
      strokeWidth={2}
      dash={[5, 5]}
      listening={false}
    />
  );
}
