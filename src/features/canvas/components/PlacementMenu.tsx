"use client";

import React from "react";
import Link from "next/link";
import { ListItemIcon, ListItemText, Menu, MenuItem } from "@mui/material";
import {
  OpenInNew as OpenIcon,
  RemoveCircleOutlined as RemoveIcon,
} from "@mui/icons-material";
import type { PlacedItem } from "@/lib/placements/shared";

/**
 * IMP-109: the menu of an item shown here from another canvas. It is
 * edited on its home canvas; here it can only be taken off.
 */
export function PlacementMenu({
  state,
  canRemove,
  onClose,
  onRemove,
}: {
  state: { placed: PlacedItem; x: number; y: number } | null;
  canRemove: boolean;
  onClose: () => void;
  onRemove: (placed: PlacedItem) => void;
}) {
  const placed = state?.placed;
  return (
    <Menu
      open={Boolean(state)}
      onClose={onClose}
      anchorReference="anchorPosition"
      anchorPosition={state ? { top: state.y, left: state.x } : undefined}
    >
      {placed?.homeCanvasName && (
        <MenuItem
          component={Link}
          href={`/canvas/${encodeURIComponent(placed.homeCanvasId)}`}
          onClick={onClose}
        >
          <ListItemIcon>
            <OpenIcon fontSize="small" />
          </ListItemIcon>
          <ListItemText
            primary="Open original"
            secondary={`Edit it on ${placed.homeCanvasName}`}
          />
        </MenuItem>
      )}
      {placed && !placed.homeCanvasName && (
        <MenuItem disabled>
          <ListItemText
            primary="Shown from another canvas"
            secondary="Only people with access to that canvas can edit it."
          />
        </MenuItem>
      )}
      {placed && canRemove && (
        <MenuItem
          onClick={() => {
            onRemove(placed);
            onClose();
          }}
        >
          <ListItemIcon>
            <RemoveIcon fontSize="small" />
          </ListItemIcon>
          <ListItemText
            primary="Remove from this canvas"
            secondary="Its other canvases keep it."
          />
        </MenuItem>
      )}
    </Menu>
  );
}
