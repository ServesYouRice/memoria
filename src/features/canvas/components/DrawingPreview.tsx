/**
 * Live preview of the pen stroke, shape or arrow being drawn. It mirrors the
 * drawing hook's in-progress state so the user is not drawing blind; the item
 * itself is still created once, on mouse-up.
 */

import React from "react";
import { Arrow, Layer, Line, Rect } from "react-konva";
import type { DrawingPath } from "@/types/canvas";
import { CANVAS_PALETTE } from "@/features/canvas/lib/canvas-palette";

const PREVIEW_STROKE_WIDTH = 2;

export interface DrawingPreviewProps {
  currentPath: DrawingPath | null;
  currentCreation: {
    type: "shape" | "arrow";
    x: number;
    y: number;
    width: number;
    height: number;
  } | null;
  zoom: number;
  /** Outline colour for shape and arrow drags; follows light/dark mode. */
  previewStroke?: string;
}

export function DrawingPreview({
  currentPath,
  currentCreation,
  zoom,
  previewStroke = CANVAS_PALETTE.light.ink,
}: DrawingPreviewProps) {
  if (currentPath) {
    return (
      <Layer listening={false}>
        <Line
          points={currentPath.points}
          stroke={currentPath.stroke}
          strokeWidth={currentPath.strokeWidth}
          opacity={currentPath.opacity ?? 1}
          tension={currentPath.tension ?? 0.5}
          lineCap="round"
          lineJoin="round"
          listening={false}
        />
      </Layer>
    );
  }

  if (currentCreation) {
    const { type, x, y, width, height } = currentCreation;
    return (
      <Layer listening={false}>
        {type === "shape" ? (
          <Rect
            x={x}
            y={y}
            width={width}
            height={height}
            stroke={previewStroke}
            strokeWidth={PREVIEW_STROKE_WIDTH}
            dash={[6 / zoom, 4 / zoom]}
            listening={false}
          />
        ) : (
          <Arrow
            points={[x, y, x + width, y + height]}
            stroke={previewStroke}
            fill={previewStroke}
            strokeWidth={PREVIEW_STROKE_WIDTH}
            listening={false}
          />
        )}
      </Layer>
    );
  }

  return null;
}
