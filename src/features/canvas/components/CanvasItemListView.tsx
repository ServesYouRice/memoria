"use client";

/**
 * IMP-022 / DEC-009 — the accessible DOM representation of canvas content.
 *
 * The Konva stage paints to a single `<canvas>` element: assistive technology
 * cannot see items, and a keyboard cannot reach them. This component renders
 * the same items as real DOM, with a heading, type, content summary, tags,
 * selection state, and only the actions the role may perform.
 *
 * Interaction contract:
 *  - Tab / Shift+Tab traverses items.
 *  - Enter (or Space) opens the focused item for editing, when permitted.
 *  - Arrow keys nudge the focused item by 1px, or 10px with Shift.
 *  - Delete / Backspace removes the focused item, when permitted.
 *  - Every outcome is announced through a polite live region.
 *
 * Connections are described non-spatially: an arrow names the items it links
 * rather than reporting coordinates.
 */

import React, { useCallback, useMemo, useRef, useState } from "react";
import {
  Box,
  Button,
  Chip,
  Paper,
  Stack,
  Typography,
  useMediaQuery,
  useTheme,
} from "@mui/material";
import type { CanvasCapabilities, CanvasItem } from "@/types/canvas";
import {
  ItemType,
  isArrowContent,
  isBookmarkContent,
  isEmbedContent,
  isFrameContent,
  isImageContent,
  isNoteContent,
  isPollContent,
  isShapeContent,
  isTextContent,
} from "@/types/canvas";
import { stripHtmlTags } from "@/lib/utils/html";
import {
  EMBED_PREVIEW_LABEL,
  describeEmbedTarget,
} from "@/lib/product-surfaces";

const NUDGE_STEP = 1;
const NUDGE_STEP_LARGE = 10;

/** Short, human name for an item — used as the row heading. */
export function describeItemHeading(item: CanvasItem): string {
  const content = item.content;

  if (isNoteContent(content)) {
    const text = stripHtmlTags(content.plainText || content.text || "").trim();
    return text ? text.split("\n")[0]!.slice(0, 80) : "Empty note";
  }
  if (isBookmarkContent(content)) {
    return content.title || content.siteName || content.url;
  }
  if (isImageContent(content)) {
    return content.alt || content.filename || "Image";
  }
  if (isTextContent(content)) {
    return content.text.trim().slice(0, 80) || "Empty text block";
  }
  if (isFrameContent(content)) {
    return content.title || "Frame";
  }
  if (isPollContent(content)) {
    return content.question;
  }
  if (isEmbedContent(content)) {
    return `${EMBED_PREVIEW_LABEL}: ${describeEmbedTarget(content.url)}`;
  }
  if (isShapeContent(content)) {
    return `${content.shapeType.replace("_", " ")} shape`;
  }
  if (item.type === ItemType.DRAWING) {
    return "Freehand drawing";
  }
  return `${item.type.toLowerCase()} item`;
}

/**
 * Longer description. Connections are named, not located: an arrow says what it
 * links, because "at x=420" means nothing without the picture.
 */
export function describeItemDetail(
  item: CanvasItem,
  itemsById: Map<string, CanvasItem>,
): string {
  const content = item.content;

  if (isArrowContent(content)) {
    const from = content.startItemId
      ? itemsById.get(content.startItemId)
      : undefined;
    const to = content.endItemId ? itemsById.get(content.endItemId) : undefined;

    if (from || to) {
      return `Connection from ${
        from ? describeItemHeading(from) : "an unattached point"
      } to ${to ? describeItemHeading(to) : "an unattached point"}.`;
    }
    return content.label
      ? `Unattached connection labelled ${content.label}.`
      : "Unattached connection.";
  }

  if (isNoteContent(content)) {
    return stripHtmlTags(content.plainText || content.text || "").slice(0, 280);
  }
  if (isBookmarkContent(content)) {
    return content.description || content.url;
  }
  if (isPollContent(content)) {
    const votes = content.options.reduce(
      (sum, option) => sum + option.votes.length,
      0,
    );
    return `${content.options.length} options, ${votes} votes recorded. Voting is unavailable.`;
  }
  if (isEmbedContent(content)) {
    return `Link preview for ${content.url}. Opens in a new tab; nothing is loaded inside the canvas.`;
  }
  if (isImageContent(content)) {
    return content.alt
      ? content.alt
      : "Image with no alternative text provided.";
  }
  return "";
}

export interface CanvasItemListViewProps {
  items: CanvasItem[];
  capabilities: CanvasCapabilities;
  selectedItemIds?: ReadonlySet<string>;
  onSelectItem?: (itemId: string) => void;
  /** Open the item for editing. Only called when `canEditItems`. */
  onActivateItem?: (item: CanvasItem) => void;
  /** Move by a delta. Only called when `canMoveItems`. */
  onNudgeItem?: (item: CanvasItem, deltaX: number, deltaY: number) => void;
  /** Only called when `canDeleteItems`. */
  onDeleteItem?: (item: CanvasItem) => void;
  /** Only rendered when `canCreateItems`. */
  onCreateItem?: () => void;
  /** Labels the region, e.g. the canvas name. */
  canvasName?: string;
  /** Search annotates matches but never removes context rows. */
  searchQuery?: string;
  searchMatchIds?: ReadonlySet<string>;
}

export function CanvasItemListView({
  items,
  capabilities,
  selectedItemIds,
  onSelectItem,
  onActivateItem,
  onNudgeItem,
  onDeleteItem,
  onCreateItem,
  canvasName,
  searchQuery = "",
  searchMatchIds,
}: CanvasItemListViewProps) {
  const theme = useTheme();
  const reducedMotion = useMediaQuery("(prefers-reduced-motion: reduce)");
  const [announcement, setAnnouncement] = useState("");
  const announcementRef = useRef(announcement);
  announcementRef.current = announcement;

  const itemsById = useMemo(
    () => new Map(items.map((item) => [item.id, item])),
    [items],
  );

  const announce = useCallback((message: string) => {
    // Repeating identical text is not re-announced by screen readers; nudging
    // twice in the same direction must still be heard.
    setAnnouncement((previous) =>
      previous === message ? `${message} ` : message,
    );
  }, []);

  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLElement>, item: CanvasItem) => {
      const heading = describeItemHeading(item);

      if (event.key === "Enter" || event.key === " ") {
        if (!capabilities.canEditItems || !onActivateItem) {
          announce(`${heading} is read-only.`);
          event.preventDefault();
          return;
        }
        event.preventDefault();
        onActivateItem(item);
        announce(`Editing ${heading}.`);
        return;
      }

      if (event.key === "Delete" || event.key === "Backspace") {
        if (!capabilities.canDeleteItems || !onDeleteItem) return;
        event.preventDefault();
        onDeleteItem(item);
        announce(`Deleted ${heading}. Recover it from Trash.`);
        return;
      }

      const step = event.shiftKey ? NUDGE_STEP_LARGE : NUDGE_STEP;
      const deltas: Record<string, [number, number]> = {
        ArrowLeft: [-step, 0],
        ArrowRight: [step, 0],
        ArrowUp: [0, -step],
        ArrowDown: [0, step],
      };
      const delta = deltas[event.key];
      if (!delta) return;

      event.preventDefault();
      if (!capabilities.canMoveItems || !onNudgeItem) {
        announce(`${heading} cannot be moved with your access level.`);
        return;
      }

      onNudgeItem(item, delta[0], delta[1]);
      announce(
        `Moved ${heading} to ${Math.round(item.positionX + delta[0])}, ${Math.round(
          item.positionY + delta[1],
        )}.`,
      );
    },
    [
      announce,
      capabilities.canDeleteItems,
      capabilities.canEditItems,
      capabilities.canMoveItems,
      onActivateItem,
      onDeleteItem,
      onNudgeItem,
    ],
  );

  return (
    <Box
      component="section"
      aria-label={
        canvasName ? `Items on ${canvasName}` : "Items on this canvas"
      }
      sx={{ p: 2 }}
    >
      <Stack
        direction={{ xs: "column", sm: "row" }}
        spacing={1}
        sx={{
          alignItems: { xs: "flex-start", sm: "center" },
          justifyContent: "space-between",
          mb: 1.5,
        }}
      >
        <Box>
          <Typography variant="h2" sx={{ fontSize: "1.125rem", mb: 0.25 }}>
            Canvas items
          </Typography>
          <Typography
            variant="body2"
            sx={{
              color: "text.secondary",
            }}
          >
            {items.length === 0
              ? "This canvas has no items yet."
              : searchQuery.trim()
                ? `${searchMatchIds?.size ?? 0} search match${searchMatchIds?.size === 1 ? "" : "es"}. All ${items.length} items remain listed as canvas context.`
                : `${items.length} item${items.length === 1 ? "" : "s"}. Tab to an item, then press Enter to edit or the arrow keys to move it.`}
          </Typography>
        </Box>
        {capabilities.canCreateItems && onCreateItem && (
          <Button variant="outlined" size="small" onClick={onCreateItem}>
            Add note
          </Button>
        )}
      </Stack>

      {/* Outcomes are announced here rather than only being painted. */}
      <Box
        aria-live="polite"
        aria-atomic="true"
        sx={{
          position: "absolute",
          width: 1,
          height: 1,
          overflow: "hidden",
          clip: "rect(0 0 0 0)",
          whiteSpace: "nowrap",
        }}
      >
        {announcement}
      </Box>

      <Stack component="ul" spacing={1} sx={{ listStyle: "none", m: 0, p: 0 }}>
        {items.map((item) => {
          const heading = describeItemHeading(item);
          const detail = describeItemDetail(item, itemsById);
          const isSelected = selectedItemIds?.has(item.id) ?? false;
          const isSearchMatch = searchMatchIds?.has(item.id) ?? false;

          return (
            <Box component="li" key={item.id}>
              <Paper
                variant="outlined"
                tabIndex={0}
                aria-label={`${item.type.toLowerCase()}: ${heading}`}
                aria-current={isSelected ? "true" : undefined}
                onFocus={() => onSelectItem?.(item.id)}
                onKeyDown={(event) => handleKeyDown(event, item)}
                sx={{
                  p: 1.5,
                  borderRadius: 2,
                  borderColor: isSelected ? "primary.main" : "divider",
                  borderWidth: isSelected ? 2 : 1,
                  bgcolor: "background.paper",
                  transition: reducedMotion
                    ? "none"
                    : theme.transitions.create("border-color"),
                  "&:focus-visible": {
                    outline: `3px solid ${theme.palette.primary.main}`,
                    outlineOffset: 2,
                  },
                }}
              >
                <Stack
                  direction="row"
                  spacing={1}
                  sx={{
                    alignItems: "center",
                    flexWrap: "wrap",
                    mb: 0.5,
                  }}
                >
                  <Chip size="small" label={item.type.toLowerCase()} />
                  {isSelected && (
                    <Chip size="small" color="primary" label="selected" />
                  )}
                  {searchQuery.trim() && (
                    <Chip
                      size="small"
                      color={isSearchMatch ? "secondary" : "default"}
                      variant={isSearchMatch ? "filled" : "outlined"}
                      label={isSearchMatch ? "search match" : "context"}
                    />
                  )}
                </Stack>

                <Typography
                  variant="subtitle1"
                  component="h3"
                  sx={{
                    fontWeight: 600,
                  }}
                >
                  {heading}
                </Typography>

                {detail && (
                  <Typography
                    variant="body2"
                    sx={{
                      color: "text.secondary",
                    }}
                  >
                    {detail}
                  </Typography>
                )}

                {item.tags.length > 0 && (
                  <Stack
                    direction="row"
                    spacing={0.5}
                    useFlexGap
                    aria-label={`Tags: ${item.tags.join(", ")}`}
                    sx={{
                      flexWrap: "wrap",
                      mt: 1,
                    }}
                  >
                    {item.tags.map((tag) => (
                      <Chip
                        key={tag}
                        size="small"
                        variant="outlined"
                        label={tag}
                      />
                    ))}
                  </Stack>
                )}

                <Stack direction="row" spacing={1} sx={{ mt: 1.5 }}>
                  {capabilities.canEditItems && onActivateItem && (
                    <Button
                      size="small"
                      onClick={() => {
                        onActivateItem(item);
                        announce(`Editing ${heading}.`);
                      }}
                    >
                      Edit
                    </Button>
                  )}
                  {capabilities.canDeleteItems && onDeleteItem && (
                    <Button
                      size="small"
                      color="error"
                      onClick={() => {
                        onDeleteItem(item);
                        announce(`Deleted ${heading}. Recover it from Trash.`);
                      }}
                    >
                      Delete
                    </Button>
                  )}
                </Stack>
              </Paper>
            </Box>
          );
        })}
      </Stack>
    </Box>
  );
}
