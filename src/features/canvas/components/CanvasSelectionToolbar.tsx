"use client";

import React from "react";
import { Box, Divider, IconButton, Paper, Tooltip } from "@mui/material";
import {
  Check as CheckIcon,
  CommentOutlined as CommentIcon,
  DeleteOutlined as DeleteIcon,
  EditOutlined as EditIcon,
  FileCopyOutlined as DuplicateIcon,
  MoreHoriz as MoreIcon,
  OpenInNew as OpenLinkIcon,
} from "@mui/icons-material";
import {
  ItemType,
  isPdfContent,
  type CanvasCapabilities,
  type CanvasItem,
} from "@/types/canvas";
import { openSavedLink, openableUrl } from "@/lib/bookmarks/open-link";
import { openPdf } from "./PdfItem";
import { noteColorOf, type NoteColorName } from "@/lib/note-colors";
import {
  NOTE_COLOR_LABELS,
  NOTE_COLOR_NAMES,
  NOTE_PALETTE,
} from "@/features/canvas/lib/note-colors";
import { useThemeMode } from "@/lib/theme-context";
import { appColor, motion } from "@/lib/theme";

const TOOLBAR_CLEARANCE = 14;
const ESTIMATED_HEIGHT = 48;
const EDGE_MARGIN = 12;

export interface CanvasSelectionToolbarProps {
  item: CanvasItem;
  capabilities: CanvasCapabilities;
  zoom: number;
  position: { x: number; y: number };
  stageSize: { width: number; height: number };
  onEdit: () => void;
  onDuplicate: () => void;
  onComments: () => void;
  onDelete: () => void;
  onMore: (point: { x: number; y: number }) => void;
  onNoteColor?: (color: NoteColorName) => void;
}

const EDITABLE_TYPES = new Set<ItemType>([
  ItemType.NOTE,
  ItemType.TEXT,
  ItemType.BOOKMARK,
  ItemType.IMAGE,
  ItemType.ARROW,
]);

/**
 * Floating contextual toolbar anchored above the currently selected canvas item.
 * Surfaces the most common actions (note colours, edit, open link/PDF, comment,
 * duplicate, delete) on first click without hunting for right-click.
 */
export function CanvasSelectionToolbar({
  item,
  capabilities,
  zoom,
  position,
  stageSize,
  onEdit,
  onDuplicate,
  onComments,
  onDelete,
  onMore,
  onNoteColor,
}: CanvasSelectionToolbarProps) {
  const { mode } = useThemeMode();

  const itemLeft = item.positionX * zoom + position.x;
  const itemTop = item.positionY * zoom + position.y;
  const itemWidth = Math.max(40, item.width * zoom);
  const itemHeight = Math.max(40, item.height * zoom);

  // Skip rendering when the item is scrolled completely out of view.
  if (
    itemLeft + itemWidth < 0 ||
    itemLeft > stageSize.width ||
    itemTop + itemHeight < 0 ||
    itemTop > stageSize.height
  ) {
    return null;
  }

  const centerX = Math.min(
    Math.max(itemLeft + itemWidth / 2, 160),
    Math.max(160, stageSize.width - 160),
  );
  const placeBelow =
    itemTop < ESTIMATED_HEIGHT + TOOLBAR_CLEARANCE + EDGE_MARGIN;
  const top = placeBelow
    ? Math.min(
        itemTop + itemHeight + TOOLBAR_CLEARANCE,
        Math.max(EDGE_MARGIN, stageSize.height - 120),
      )
    : Math.max(EDGE_MARGIN, itemTop - TOOLBAR_CLEARANCE - ESTIMATED_HEIGHT);

  const showNoteColors =
    item.type === ItemType.NOTE &&
    capabilities.canEditItems &&
    Boolean(onNoteColor);
  const currentNoteColor = showNoteColors
    ? noteColorOf(item.content)
    : "yellow";

  const linkUrl =
    item.type === ItemType.BOOKMARK
      ? openableUrl((item.content as { url?: unknown }).url)
      : null;
  const pdf =
    item.type === ItemType.PDF && isPdfContent(item.content)
      ? item.content
      : null;
  const canEditItem =
    capabilities.canEditItems && EDITABLE_TYPES.has(item.type);

  const hasActions =
    showNoteColors ||
    Boolean(linkUrl) ||
    Boolean(pdf) ||
    canEditItem ||
    capabilities.canComment ||
    capabilities.canCreateItems ||
    capabilities.canDeleteItems;

  if (!hasActions) return null;

  return (
    <Box
      onPointerDown={(event) => event.stopPropagation()}
      sx={{
        position: "absolute",
        left: centerX,
        top,
        transform: "translateX(-50%)",
        zIndex: 90,
        pointerEvents: "auto",
      }}
    >
      <Paper
        elevation={0}
        role="toolbar"
        aria-label="Selected item actions"
        sx={{
          display: "flex",
          alignItems: "center",
          gap: 0.5,
          px: 1,
          py: 0.5,
          borderRadius: 999,
          bgcolor: appColor("floatingSurface"),
          backdropFilter: "blur(12px)",
          border: `1px solid ${appColor("floatingBorder")}`,
          boxShadow: appColor("floatingShadow"),
          animation: `toolbarIn 170ms ${motion.easeOut}`,
        }}
      >
        {showNoteColors && onNoteColor && (
          <>
            <Box
              role="group"
              aria-label="Quick note colour"
              sx={{ display: "flex", alignItems: "center", gap: 0.5, px: 0.5 }}
            >
              {NOTE_COLOR_NAMES.map((name) => {
                const colors = NOTE_PALETTE[mode][name];
                const selected = name === currentNoteColor;
                return (
                  <Tooltip key={name} title={NOTE_COLOR_LABELS[name]}>
                    <Box
                      component="button"
                      type="button"
                      aria-label={`Set note colour to ${NOTE_COLOR_LABELS[name]}`}
                      aria-pressed={selected}
                      onClick={() => onNoteColor(name)}
                      sx={{
                        width: 22,
                        height: 22,
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
                        transform: selected ? "scale(1.14)" : "scale(1)",
                        transition: `transform 200ms ${motion.springSnappy}, border-color 140ms ease`,
                        "&:hover": { transform: "scale(1.16)" },
                        "&:focus-visible": {
                          outline: "2px solid",
                          outlineColor: "primary.main",
                          outlineOffset: 2,
                        },
                      }}
                    >
                      {selected && <CheckIcon sx={{ fontSize: 13 }} />}
                    </Box>
                  </Tooltip>
                );
              })}
            </Box>
            <Divider orientation="vertical" flexItem sx={{ my: 0.5 }} />
          </>
        )}

        {linkUrl && (
          <Tooltip title="Open link">
            <IconButton
              size="small"
              aria-label="Open link"
              onClick={() => openSavedLink({ id: item.id, url: linkUrl })}
            >
              <OpenLinkIcon fontSize="small" />
            </IconButton>
          </Tooltip>
        )}

        {pdf && (
          <Tooltip title="Open PDF">
            <IconButton
              size="small"
              aria-label="Open PDF"
              onClick={() => openPdf(pdf)}
            >
              <OpenLinkIcon fontSize="small" />
            </IconButton>
          </Tooltip>
        )}

        {canEditItem && (
          <Tooltip title="Edit">
            <IconButton size="small" aria-label="Edit item" onClick={onEdit}>
              <EditIcon fontSize="small" />
            </IconButton>
          </Tooltip>
        )}

        {capabilities.canComment && (
          <Tooltip title="Comments">
            <IconButton
              size="small"
              aria-label="Item comments"
              onClick={onComments}
            >
              <CommentIcon fontSize="small" />
            </IconButton>
          </Tooltip>
        )}

        {capabilities.canCreateItems && (
          <Tooltip title="Duplicate (Ctrl+D)">
            <IconButton
              size="small"
              aria-label="Duplicate item"
              onClick={onDuplicate}
            >
              <DuplicateIcon fontSize="small" />
            </IconButton>
          </Tooltip>
        )}

        {capabilities.canDeleteItems && (
          <Tooltip title="Delete (Del)">
            <IconButton
              size="small"
              aria-label="Delete item"
              onClick={onDelete}
              sx={{ "&:hover": { color: "error.main" } }}
            >
              <DeleteIcon fontSize="small" />
            </IconButton>
          </Tooltip>
        )}

        <Tooltip title="More item actions">
          <IconButton
            size="small"
            aria-label="More item actions"
            onClick={(event) => {
              const rect = event.currentTarget.getBoundingClientRect();
              onMore({ x: rect.left, y: rect.bottom + 6 });
            }}
          >
            <MoreIcon fontSize="small" />
          </IconButton>
        </Tooltip>
      </Paper>
    </Box>
  );
}
