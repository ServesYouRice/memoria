"use client";

import React from "react";
import {
  Paper,
  ToggleButton,
  ToggleButtonGroup,
  Stack,
  Divider,
  Slider,
  Box,
  Tooltip,
} from "@mui/material";
import { Create, Brush, Gesture } from "@mui/icons-material";
import { useCanvasStore } from "@/stores/canvasStore";
import { useCanvasPalette } from "@/features/canvas/lib/canvas-palette";
import { appColor, motion } from "@/lib/theme";

export type DrawingToolType = "pen" | "marker" | "highlighter";

const INK_SWATCHES = [
  { label: "Ink", light: "#0f172a", dark: "#e2e8f0" },
  { label: "Cobalt", light: "#2c5fc9", dark: "#60a5fa" },
  { label: "Crimson", light: "#d61a44", dark: "#fb7185" },
  { label: "Emerald", light: "#16a34a", dark: "#4ade80" },
  { label: "Amber", light: "#d97706", dark: "#fbbf24" },
  { label: "Violet", light: "#7c3aed", dark: "#c084fc" },
] as const;

export const DrawingToolbar: React.FC = () => {
  const { drawingState, setDrawingState } = useCanvasStore();
  const palette = useCanvasPalette();
  const { toolType, strokeWidth, color } = drawingState;
  const isDark = palette.ink === "#e2e8f0";

  const handleToolChange = (
    _: React.MouseEvent<HTMLElement>,
    newTool: DrawingToolType,
  ) => {
    if (newTool) {
      const updates: Partial<typeof drawingState> = { toolType: newTool };

      if (newTool === "pen") updates.strokeWidth = 3;
      if (newTool === "marker") updates.strokeWidth = 8;
      if (newTool === "highlighter") {
        updates.strokeWidth = 15;
        updates.color = "rgba(251, 191, 36, 0.45)";
      } else if (color.startsWith("rgba(")) {
        updates.color = palette.ink;
      }

      setDrawingState(updates);
    }
  };

  return (
    <Paper
      elevation={0}
      role="toolbar"
      aria-label="Drawing options"
      sx={{
        px: 1.5,
        py: 0.75,
        borderRadius: 3,
        bgcolor: appColor("floatingSurface"),
        backdropFilter: "blur(12px)",
        border: `1px solid ${appColor("floatingBorder")}`,
        boxShadow: appColor("floatingShadow"),
        animation: `toolbarIn 180ms ${motion.easeOut}`,
      }}
    >
      <Stack
        direction="row"
        spacing={1.5}
        divider={<Divider orientation="vertical" flexItem />}
        sx={{ alignItems: "center" }}
      >
        <ToggleButtonGroup
          value={toolType}
          exclusive
          onChange={handleToolChange}
          size="small"
        >
          <ToggleButton value="pen" aria-label="pen">
            <Tooltip title="Pen">
              <Create fontSize="small" />
            </Tooltip>
          </ToggleButton>
          <ToggleButton value="marker" aria-label="marker">
            <Tooltip title="Marker">
              <Brush fontSize="small" />
            </Tooltip>
          </ToggleButton>
          <ToggleButton value="highlighter" aria-label="highlighter">
            <Tooltip title="Highlighter">
              <Gesture fontSize="small" />
            </Tooltip>
          </ToggleButton>
        </ToggleButtonGroup>

        <Box sx={{ width: 92, display: "flex", alignItems: "center" }}>
          <Slider
            size="small"
            value={strokeWidth}
            min={1}
            max={30}
            onChange={(_, value) =>
              setDrawingState({ strokeWidth: value as number })
            }
            aria-label="Stroke width"
          />
        </Box>

        <Box
          role="group"
          aria-label="Ink colour"
          sx={{ display: "flex", alignItems: "center", gap: 0.75 }}
        >
          {INK_SWATCHES.map((swatch) => {
            const hex = isDark ? swatch.dark : swatch.light;
            const active = color.toLowerCase() === hex.toLowerCase();
            return (
              <Tooltip key={swatch.label} title={swatch.label}>
                <Box
                  component="button"
                  type="button"
                  aria-label={swatch.label}
                  aria-pressed={active}
                  onClick={() => setDrawingState({ color: hex })}
                  sx={{
                    width: 22,
                    height: 22,
                    p: 0,
                    borderRadius: "50%",
                    border: "2px solid",
                    borderColor: active ? "primary.main" : "divider",
                    bgcolor: hex,
                    cursor: "pointer",
                    transform: active ? "scale(1.16)" : "scale(1)",
                    transition: `transform 200ms ${motion.springSnappy}, border-color 150ms ease`,
                    "&:hover": { transform: "scale(1.16)" },
                  }}
                />
              </Tooltip>
            );
          })}
          <Tooltip title="Custom colour">
            <Box
              component="input"
              type="color"
              aria-label="Stroke color"
              value={color.startsWith("#") ? color : "#fbbf24"}
              onChange={(event: React.ChangeEvent<HTMLInputElement>) =>
                setDrawingState({ color: event.target.value })
              }
              sx={{
                width: 24,
                height: 24,
                border: "1px solid",
                borderColor: "divider",
                borderRadius: "50%",
                padding: 0,
                cursor: "pointer",
                bgcolor: "transparent",
                overflow: "hidden",
              }}
            />
          </Tooltip>
        </Box>
      </Stack>
    </Paper>
  );
};
