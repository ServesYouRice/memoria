"use client";

import React from "react";
import {
  Menu,
  MenuItem,
  ListItemIcon,
  ListItemText,
  Divider,
} from "@mui/material";
import {
  Delete as DeleteIcon,
  ContentCopy as CopyIcon,
  FileCopy as DuplicateIcon,
  Comment as CommentIcon,
} from "@mui/icons-material";
import type { CanvasCapabilities } from "@/types/canvas";

export interface ContextMenuPosition {
  x: number;
  y: number;
}

export interface CanvasContextMenuProps {
  position: ContextMenuPosition | null;
  /** IMP-008: only offer the actions this role may actually perform. */
  capabilities: CanvasCapabilities;
  onClose: () => void;
  onDelete: () => void;
  onDuplicate: () => void;
  onCopy: () => void;
  onComments: () => void;
}

export function CanvasContextMenu({
  position,
  capabilities,
  onClose,
  onDelete,
  onDuplicate,
  onCopy,
  onComments,
}: CanvasContextMenuProps) {
  const open = Boolean(position);

  const handleAction = (action: () => void) => {
    action();
    onClose();
  };

  return (
    <Menu
      open={open}
      onClose={onClose}
      anchorReference="anchorPosition"
      anchorPosition={
        position ? { top: position.y, left: position.x } : undefined
      }
    >
      <MenuItem onClick={() => handleAction(onCopy)}>
        <ListItemIcon>
          <CopyIcon fontSize="small" />
        </ListItemIcon>
        <ListItemText>Copy</ListItemText>
      </MenuItem>
      {capabilities.canCreateItems && (
        <MenuItem onClick={() => handleAction(onDuplicate)}>
          <ListItemIcon>
            <DuplicateIcon fontSize="small" />
          </ListItemIcon>
          <ListItemText>Duplicate</ListItemText>
        </MenuItem>
      )}
      {capabilities.canComment && (
        <MenuItem onClick={() => handleAction(onComments)}>
          <ListItemIcon>
            <CommentIcon fontSize="small" />
          </ListItemIcon>
          <ListItemText>Comments</ListItemText>
        </MenuItem>
      )}
      {capabilities.canDeleteItems && [
        <Divider key="delete-divider" />,
        <MenuItem key="delete" onClick={() => handleAction(onDelete)}>
          <ListItemIcon>
            <DeleteIcon fontSize="small" color="error" />
          </ListItemIcon>
          <ListItemText sx={{ color: "error.main" }}>Delete</ListItemText>
        </MenuItem>,
      ]}
    </Menu>
  );
}
