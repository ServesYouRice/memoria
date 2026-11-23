"use client";

import React from "react";
import {
  ButtonBase,
  Divider,
  IconButton,
  Paper,
  Tooltip,
  Typography,
} from "@mui/material";
import {
  ZoomIn,
  ZoomOut,
  FitScreen,
  GridOn as GridOnIcon,
  GridOff as GridOffIcon,
  Straighten as SnapIcon,
} from "@mui/icons-material";
import { appColor, motion } from "@/lib/theme";

export const ZOOM_STEP = 0.1;
export const MIN_ZOOM = 0.1;
export const MAX_ZOOM = 5;

export function zoomedIn(zoom: number): number {
  return Math.round(Math.min(zoom + ZOOM_STEP, MAX_ZOOM) * 100) / 100;
}

export function zoomedOut(zoom: number): number {
  return Math.round(Math.max(zoom - ZOOM_STEP, MIN_ZOOM) * 100) / 100;
}

export interface CanvasViewControlsProps {
  zoom: number;
  onZoomChange: (zoom: number) => void;
  onFitToScreen: () => void;
  gridVisible: boolean;
  onGridToggle: () => void;
  snapEnabled: boolean;
  onSnapToggle?: () => void;
}

/**
 * IMP-084: the view tools (zoom, fit, grid, snap) in one corner of the
 * canvas, each with a tooltip and an accessible name.
 */
export function CanvasViewControls({
  zoom,
  onZoomChange,
  onFitToScreen,
  gridVisible,
  onGridToggle,
  snapEnabled,
  onSnapToggle,
}: CanvasViewControlsProps) {
  return (
    <Paper
      elevation={0}
      role="toolbar"
      aria-label="View"
      sx={{
        position: "absolute",
        right: 16,
        bottom: 16,
        zIndex: 100,
        display: { xs: "none", sm: "flex" },
        alignItems: "center",
        gap: 0.25,
        p: 0.5,
        borderRadius: 3.5,
        bgcolor: appColor("floatingSurface"),
        backdropFilter: "blur(12px)",
        border: `1px solid ${appColor("floatingBorder")}`,
        boxShadow: appColor("floatingShadow"),
      }}
    >
      <Tooltip title="Zoom out">
        <IconButton
          aria-label="Zoom out"
          onClick={() => onZoomChange(zoomedOut(zoom))}
        >
          <ZoomOut fontSize="small" />
        </IconButton>
      </Tooltip>
      <Tooltip title="Reset zoom to 100%">
        <ButtonBase
          onClick={() => onZoomChange(1)}
          aria-label="Reset zoom to 100%"
          sx={{
            borderRadius: 1.5,
            px: 0.75,
            py: 0.5,
            minWidth: 46,
            transition: `background-color 150ms ${motion.easeOut}`,
            "&:hover": { bgcolor: "action.hover" },
          }}
        >
          <Typography
            component="output"
            aria-label="Zoom level"
            sx={{
              textAlign: "center",
              fontSize: 13,
              fontWeight: 600,
              fontVariantNumeric: "tabular-nums",
            }}
          >
            {Math.round(zoom * 100)}%
          </Typography>
        </ButtonBase>
      </Tooltip>
      <Tooltip title="Zoom in">
        <IconButton
          aria-label="Zoom in"
          onClick={() => onZoomChange(zoomedIn(zoom))}
        >
          <ZoomIn fontSize="small" />
        </IconButton>
      </Tooltip>
      <Tooltip title="Fit everything on screen">
        <IconButton aria-label="Fit to screen" onClick={onFitToScreen}>
          <FitScreen fontSize="small" />
        </IconButton>
      </Tooltip>
      <Divider orientation="vertical" flexItem sx={{ mx: 0.25 }} />
      <Tooltip title={gridVisible ? "Hide grid lines" : "Show grid lines"}>
        <IconButton
          aria-label="Grid lines"
          aria-pressed={gridVisible}
          color={gridVisible ? "primary" : "default"}
          onClick={onGridToggle}
        >
          {gridVisible ? (
            <GridOnIcon fontSize="small" />
          ) : (
            <GridOffIcon fontSize="small" />
          )}
        </IconButton>
      </Tooltip>
      {onSnapToggle && (
        <Tooltip
          title={
            snapEnabled
              ? "Items snap to the grid (click to stop)"
              : "Snap items to the grid"
          }
        >
          <IconButton
            aria-label="Snap to grid"
            aria-pressed={snapEnabled}
            color={snapEnabled ? "primary" : "default"}
            onClick={onSnapToggle}
          >
            <SnapIcon fontSize="small" />
          </IconButton>
        </Tooltip>
      )}
    </Paper>
  );
}
