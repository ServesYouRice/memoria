/**
 * SelectionBox Component
 *
 * Visual rectangle overlay for multi-select on canvas
 */

"use client";

import React from "react";
import { Rect } from "react-konva";

export interface SelectionBoxProps {
  x: number;
  y: number;
  width: number;
  height: number;
}

export function SelectionBox({ x, y, width, height }: SelectionBoxProps) {
  return (
    <Rect
      x={x}
      y={y}
      width={width}
      height={height}
      fill="rgba(33, 150, 243, 0.1)"
      stroke="#2196F3"
      strokeWidth={2}
      dash={[5, 5]}
      listening={false}
    />
  );
}
