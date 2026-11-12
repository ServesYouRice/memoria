"use client";

import React from "react";
import {
  Box,
  Menu,
  MenuItem,
  ListItemIcon,
  ListItemText,
  Divider,
  Tooltip,
  Typography,
} from "@mui/material";
import {
  Delete as DeleteIcon,
  ContentCopy as CopyIcon,
  FileCopy as DuplicateIcon,
  Comment as CommentIcon,
  OpenInNew as OpenLinkIcon,
  Check as CheckIcon,
} from "@mui/icons-material";
import {
  ItemType,
  type CanvasCapabilities,
  type CanvasItem,
} from "@/types/canvas";
import { pileTransformMenuItems, usePileTransform } from "./PileTransformMenu";
import { openSavedLink, openableUrl } from "@/lib/bookmarks/open-link";
import { noteColorOf, type NoteColorName } from "@/lib/note-colors";
import {
  NOTE_COLOR_LABELS,
  NOTE_COLOR_NAMES,
  NOTE_PALETTE,
} from "@/features/canvas/lib/note-colors";
import { useThemeMode } from "@/lib/theme-context";

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
  /** IMP-085: recolour the note the menu is for. */
  onNoteColor?: (color: NoteColorName) => void;
}

/** A row of colour swatches for a sticky note (IMP-085). */
function NoteColorRow({
  current,
  onPick,
}: {
  current: NoteColorName;
  onPick: (color: NoteColorName) => void;
}) {
  const mode = useThemeMode().mode;
  return (
    <Box sx={{ px: 2, pt: 0.5, pb: 1 }}>
      <Typography
        variant="caption"
        component="div"
        id="note-colour-label"
        sx={{ color: "text.secondary", mb: 0.75 }}
      >
        Note colour
      </Typography>
      <Box
        role="group"
        aria-labelledby="note-colour-label"
        sx={{ display: "flex", gap: 0.75 }}
      >
        {NOTE_COLOR_NAMES.map((name) => {
          const colors = NOTE_PALETTE[mode][name];
          const selected = name === current;
          return (
            <Tooltip key={name} title={NOTE_COLOR_LABELS[name]}>
              <Box
                component="button"
                type="button"
                aria-label={NOTE_COLOR_LABELS[name]}
                aria-pressed={selected}
                onClick={() => onPick(name)}
                sx={{
                  width: 32,
                  height: 32,
                  p: 0,
                  borderRadius: "50%",
                  border: "2px solid",
                  borderColor: selected ? "primary.main" : colors.stroke,
                  bgcolor: colors.fill,
                  color: colors.text,
                  cursor: "pointer",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  "&:focus-visible": {
                    outline: "2px solid",
                    outlineColor: "primary.main",
                    outlineOffset: 2,
                  },
                }}
              >
                {selected && <CheckIcon sx={{ fontSize: 16 }} />}
              </Box>
            </Tooltip>
          );
        })}
      </Box>
    </Box>
  );
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
  onNoteColor,
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

  const showNoteColors =
    item?.type === ItemType.NOTE &&
    capabilities.canEditItems &&
    Boolean(onNoteColor);

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
      {showNoteColors && item && (
        <NoteColorRow
          current={noteColorOf(item.content)}
          onPick={(color) => handleAction(() => onNoteColor!(color))}
        />
      )}
      {showNoteColors && <Divider />}
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
