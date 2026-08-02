"use client";

/**
 * IMP-022 — prioritized canvas toolbar.
 *
 * The canvas header carries far more actions than fit on a phone. Rather than
 * letting them overflow off-screen, secondary actions are declared as data and
 * rendered two ways: inline icon buttons from `md` up, and a single overflow
 * menu below it. Every action stays reachable at 320px, keyboard-operable, and
 * carries the same accessible name in both layouts.
 */

import React, { useState } from "react";
import {
  Badge,
  Box,
  IconButton,
  ListItemIcon,
  ListItemText,
  Menu,
  MenuItem,
  Tooltip,
  useMediaQuery,
  useTheme,
} from "@mui/material";
import { MoreHoriz as MoreIcon } from "@mui/icons-material";

export interface CanvasSecondaryAction {
  key: string;
  /** Accessible name, identical in both layouts. */
  label: string;
  icon: React.ReactNode;
  onClick: () => void;
  color?: "primary" | "secondary" | "default" | "warning";
  /** Count shown on the inline icon and appended to the menu label. */
  badgeCount?: number;
}

interface CanvasSecondaryActionsProps {
  actions: CanvasSecondaryAction[];
}

export function CanvasSecondaryActions({
  actions,
}: CanvasSecondaryActionsProps) {
  const theme = useTheme();
  const collapse = useMediaQuery(theme.breakpoints.down("md"));
  const [anchorEl, setAnchorEl] = useState<HTMLElement | null>(null);

  if (actions.length === 0) {
    return null;
  }

  if (!collapse) {
    return (
      <>
        {actions.map((action) => (
          <Tooltip key={action.key} title={action.label}>
            <IconButton
              aria-label={action.label}
              onClick={action.onClick}
              color={action.color === "warning" ? "default" : action.color}
              sx={{
                mr: 1,
                ...(action.color === "warning"
                  ? { color: "warning.main" }
                  : {}),
              }}
            >
              {action.badgeCount ? (
                <Badge badgeContent={action.badgeCount} color="primary">
                  {action.icon}
                </Badge>
              ) : (
                action.icon
              )}
            </IconButton>
          </Tooltip>
        ))}
      </>
    );
  }

  const totalBadge = actions.reduce(
    (sum, action) => sum + (action.badgeCount || 0),
    0,
  );

  return (
    <Box sx={{ mr: 1 }}>
      <Tooltip title="More canvas actions">
        <IconButton
          aria-label="More canvas actions"
          aria-haspopup="menu"
          aria-expanded={Boolean(anchorEl)}
          onClick={(event) => setAnchorEl(event.currentTarget)}
        >
          <Badge badgeContent={totalBadge} color="primary">
            <MoreIcon />
          </Badge>
        </IconButton>
      </Tooltip>
      <Menu
        anchorEl={anchorEl}
        open={Boolean(anchorEl)}
        onClose={() => setAnchorEl(null)}
        slotProps={{
          list: { "aria-label": "More canvas actions" },
        }}
      >
        {actions.map((action) => (
          <MenuItem
            key={action.key}
            onClick={() => {
              setAnchorEl(null);
              action.onClick();
            }}
          >
            <ListItemIcon>{action.icon}</ListItemIcon>
            <ListItemText>
              {action.badgeCount
                ? `${action.label} (${action.badgeCount})`
                : action.label}
            </ListItemText>
          </MenuItem>
        ))}
      </Menu>
    </Box>
  );
}
