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
  OpenInNew as OpenLinkIcon,
} from "@mui/icons-material";
import {
  ItemType,
  type CanvasCapabilities,
  type CanvasItem,
} from "@/types/canvas";
import { pileTransformMenuItems, usePileTransform } from "./PileTransformMenu";
import { openSavedLink, openableUrl } from "@/lib/bookmarks/open-link";

export interface ContextMenuPosition {
  x: number;
  y: number;
  /** The item the menu was opened on. */
  itemId?: string;
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
  /** IMP-069: the canvas and the item the menu is for (frame AI actions). */
  canvasId?: string;
  item?: CanvasItem;
}

export function CanvasContextMenu({
  position,
  capabilities,
  onClose,
  onDelete,
  onDuplicate,
  onCopy,
  onComments,
  canvasId,
  item,
}: CanvasContextMenuProps) {
  const open = Boolean(position);
  const isFrame = item?.type === ItemType.FRAME;
  // Ask about AI only once a frame's menu opens for someone who can edit.
  const pile = usePileTransform(
    canvasId,
    isFrame && capabilities.canEditItems && capabilities.canCreateItems,
  );
  const frameId = isFrame ? item.id : null;
  const showPileActions = open && frameId !== null && pile.available;
  // IMP-070: opening a link from the board counts as "opened" for the recap.
  const linkUrl =
    item?.type === ItemType.BOOKMARK
      ? openableUrl((item.content as { url?: unknown }).url)
      : null;

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
      {linkUrl && item && (
        <MenuItem
          onClick={() =>
            handleAction(() => openSavedLink({ id: item.id, url: linkUrl }))
          }
        >
          <ListItemIcon>
            <OpenLinkIcon fontSize="small" />
          </ListItemIcon>
          <ListItemText>Open link</ListItemText>
        </MenuItem>
      )}
      {capabilities.canCopyItems && (
        <MenuItem onClick={() => handleAction(onCopy)}>
          <ListItemIcon>
            <CopyIcon fontSize="small" />
          </ListItemIcon>
          <ListItemText>Copy</ListItemText>
        </MenuItem>
      )}
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
      {showPileActions &&
        pileTransformMenuItems({
          pending: pile.pending,
          onSelect: (kind) => handleAction(() => void pile.run(frameId!, kind)),
        })}
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
