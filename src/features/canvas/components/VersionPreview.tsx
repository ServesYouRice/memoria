/**
 * Version Preview
 * A read-only picture of a stored canvas snapshot: every item drawn as a
 * labelled box at its saved position and size. Nothing here is editable and
 * nothing is sent to the server.
 */

"use client";

import React, { useMemo } from "react";
import { Box, Typography, useTheme } from "@mui/material";
import type { CanvasVersionSnapshot } from "@/lib/hooks/use-canvas-versions";

const PADDING = 40;
const MAX_LABEL_LENGTH = 40;

interface PreviewBox {
  key: string;
  type: string;
  x: number;
  y: number;
  width: number;
  height: number;
  label: string;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object"
    ? (value as Record<string, unknown>)
    : {};
}

function firstString(...values: unknown[]): string {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "";
}

/** A short, plain-text label for an item; never HTML. */
export function previewLabel(type: string, content: unknown): string {
  const record = asRecord(content);
  const text = firstString(
    record.plainText,
    record.text,
    record.title,
    record.url,
    record.label,
  );
  const label = (text || type.toLowerCase()).replace(/\s+/g, " ");
  return label.length > MAX_LABEL_LENGTH
    ? `${label.slice(0, MAX_LABEL_LENGTH - 1)}…`
    : label;
}

export function toPreviewBoxes(
  snapshot: CanvasVersionSnapshot | null | undefined,
): PreviewBox[] {
  const items = Array.isArray(snapshot?.items) ? snapshot.items : [];
  return items
    .filter(
      (item) =>
        Number.isFinite(item.positionX) &&
        Number.isFinite(item.positionY) &&
        Number.isFinite(item.width) &&
        Number.isFinite(item.height),
    )
    .map((item, index) => ({
      key: item.id ?? `item-${index}`,
      type: String(item.type),
      x: item.positionX,
      y: item.positionY,
      width: Math.max(item.width, 1),
      height: Math.max(item.height, 1),
      label: previewLabel(String(item.type), item.content),
    }));
}

export interface VersionPreviewProps {
  snapshot: CanvasVersionSnapshot | null | undefined;
  /** The version's name, for the accessible label. */
  name: string;
}

export function VersionPreview({ snapshot, name }: VersionPreviewProps) {
  const theme = useTheme();
  // CSS-variables theme: `theme.vars` follows the active colour scheme.
  const palette = (theme.vars ?? theme).palette;
  const boxes = useMemo(() => toPreviewBoxes(snapshot), [snapshot]);

  const fillFor = (type: string) => {
    switch (type) {
      case "NOTE":
        return palette.warning.light;
      case "BOOKMARK":
        return palette.info.light;
      case "IMAGE":
        return palette.secondary.light;
      case "FRAME":
        return "transparent";
      default:
        return palette.action.selected;
    }
  };

  if (boxes.length === 0) {
    return (
      <Box
        sx={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          minHeight: 240,
          border: 1,
          borderColor: "divider",
          borderRadius: 1,
        }}
      >
        <Typography variant="body2" sx={{ color: "text.secondary" }}>
          This version has no items
        </Typography>
      </Box>
    );
  }

  const minX = Math.min(...boxes.map((box) => box.x));
  const minY = Math.min(...boxes.map((box) => box.y));
  const maxX = Math.max(...boxes.map((box) => box.x + box.width));
  const maxY = Math.max(...boxes.map((box) => box.y + box.height));
  const viewBox = [
    minX - PADDING,
    minY - PADDING,
    maxX - minX + PADDING * 2,
    maxY - minY + PADDING * 2,
  ].join(" ");
  // Keep labels legible whatever the canvas extent: size text from the view.
  const extent = Math.max(maxX - minX, maxY - minY, 1);
  const fontSize = Math.max(extent / 60, 6);

  return (
    <Box
      sx={{
        border: 1,
        borderColor: "divider",
        borderRadius: 1,
        bgcolor: "background.default",
        overflow: "hidden",
      }}
    >
      <svg
        role="img"
        aria-label={`Read-only preview of ${name}, ${boxes.length} ${
          boxes.length === 1 ? "item" : "items"
        }`}
        viewBox={viewBox}
        preserveAspectRatio="xMidYMid meet"
        style={{ display: "block", width: "100%", height: 280 }}
      >
        {boxes.map((box) => (
          <g key={box.key} data-preview-item={box.type}>
            <title>{box.label}</title>
            <rect
              x={box.x}
              y={box.y}
              width={box.width}
              height={box.height}
              rx={Math.min(box.width, box.height) * 0.06}
              style={{ fill: fillFor(box.type), stroke: palette.divider }}
              strokeWidth={Math.max(extent / 600, 0.5)}
            />
            {box.height >= fontSize * 1.5 && box.width >= fontSize * 3 && (
              <text
                x={box.x + fontSize * 0.5}
                y={box.y + fontSize * 1.4}
                fontSize={fontSize}
                style={{ pointerEvents: "none", fill: palette.text.primary }}
              >
                {box.label.slice(0, Math.floor(box.width / (fontSize * 0.6)))}
              </text>
            )}
          </g>
        ))}
      </svg>
    </Box>
  );
}
