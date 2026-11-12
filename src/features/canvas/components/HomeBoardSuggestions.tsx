"use client";

/**
 * IMP-066: on the Inbox, each item with a suggested home board shows it
 * under the item ("Looks like Rome trip") with Accept and Dismiss. Accepting
 * moves the item as one ChangeSet, and a toast offers Undo; items filed this
 * week (by hand or automatically) can be undone from the "Filed" menu.
 */

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import {
  Box,
  Button,
  IconButton,
  Menu,
  MenuItem,
  ListItemText,
  Paper,
  Tooltip,
  Typography,
} from "@mui/material";
import {
  Check as CheckIcon,
  Close as CloseIcon,
  DriveFileMove as FiledIcon,
} from "@mui/icons-material";
import { apiFetch } from "@/lib/api/fetch-client";
import type { CanvasItem } from "@/types/canvas";

const REFRESH_MS = 30_000;

/** Suggestions are shown on the owner's Inbox board (`INBOX_CANVAS_NAME`). */
export function isInboxBoardName(name: string | null | undefined) {
  return (name ?? "").trim().toLowerCase() === "inbox";
}
const CHIP_GAP = 6;

export interface HomeBoardSuggestionView {
  itemId: string;
  boardId: string;
  boardName: string;
  confidence: number;
  reasons: Array<"board-name" | "tags" | "similar-items">;
}

export interface FiledItemView {
  itemId: string;
  label: string;
  boardId: string;
  boardName: string;
  automatic: boolean;
  actedAt: string;
}

interface HomeBoardPayload {
  suggestions: HomeBoardSuggestionView[];
  recentlyFiled: FiledItemView[];
}

const REASON_TEXT: Record<HomeBoardSuggestionView["reasons"][number], string> =
  {
    "board-name": "its tags or title match the canvas name",
    tags: "the canvas already holds items with these tags",
    "similar-items": "it reads like other items on the canvas",
  };

export function describeReasons(reasons: HomeBoardSuggestionView["reasons"]) {
  const parts = reasons.map((reason) => REASON_TEXT[reason]).filter(Boolean);
  return parts.length > 0 ? `Suggested because ${parts.join(", and ")}.` : "";
}

async function postAction(
  itemId: string,
  action: "accept" | "dismiss" | "undo",
) {
  const response = await apiFetch(
    `/api/v1/items/${encodeURIComponent(itemId)}/home-board`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action }),
    },
  );
  return (await response.json()) as { boardName?: string };
}

function errorText(error: unknown, fallback: string) {
  return error instanceof Error && error.message ? error.message : fallback;
}

interface HomeBoardSuggestionsProps {
  canvasId: string;
  items: CanvasItem[];
  zoom: number;
  position: { x: number; y: number };
  stageSize: { width: number; height: number };
}

export function HomeBoardSuggestions({
  canvasId,
  items,
  zoom,
  position,
  stageSize,
}: HomeBoardSuggestionsProps) {
  const [data, setData] = useState<HomeBoardPayload>({
    suggestions: [],
    recentlyFiled: [],
  });
  const [busyItemId, setBusyItemId] = useState<string | null>(null);
  const [menuAnchor, setMenuAnchor] = useState<HTMLElement | null>(null);

  const load = useCallback(
    async (signal?: AbortSignal) => {
      try {
        const response = await fetch(
          `/api/v1/canvases/${encodeURIComponent(canvasId)}/home-boards`,
          { signal },
        );
        if (!response.ok) return;
        setData((await response.json()) as HomeBoardPayload);
      } catch {
        // Suggestions are optional; the Inbox works without them.
      }
    },
    [canvasId],
  );

  // New suggestions arrive once background enrichment has run, so refresh
  // when the item set changes and on a slow timer.
  const itemKey = useMemo(
    () =>
      items
        .map((item) => item.id)
        .sort()
        .join(","),
    [items],
  );
  useEffect(() => {
    const controller = new AbortController();
    const timer = setTimeout(() => void load(controller.signal), 500);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [itemKey, load]);
  useEffect(() => {
    const interval = setInterval(() => void load(), REFRESH_MS);
    return () => clearInterval(interval);
  }, [load]);

  const undo = useCallback(
    async (itemId: string) => {
      setBusyItemId(itemId);
      try {
        await postAction(itemId, "undo");
        toast.success("Moved back to the Inbox.");
        await load();
      } catch (error) {
        toast.error(errorText(error, "Could not undo the move."));
      } finally {
        setBusyItemId(null);
      }
    },
    [load],
  );

  const accept = useCallback(
    async (suggestion: HomeBoardSuggestionView) => {
      setBusyItemId(suggestion.itemId);
      try {
        await postAction(suggestion.itemId, "accept");
        setData((current) => ({
          ...current,
          suggestions: current.suggestions.filter(
            (entry) => entry.itemId !== suggestion.itemId,
          ),
        }));
        toast.success(`Filed in ${suggestion.boardName}.`, {
          action: {
            label: "Undo",
            onClick: () => void undo(suggestion.itemId),
          },
        });
        void load();
      } catch (error) {
        toast.error(errorText(error, "Could not file this item."));
        void load();
      } finally {
        setBusyItemId(null);
      }
    },
    [load, undo],
  );

  const dismiss = useCallback(async (suggestion: HomeBoardSuggestionView) => {
    setBusyItemId(suggestion.itemId);
    try {
      await postAction(suggestion.itemId, "dismiss");
      setData((current) => ({
        ...current,
        suggestions: current.suggestions.filter(
          (entry) => entry.itemId !== suggestion.itemId,
        ),
      }));
    } catch (error) {
      toast.error(errorText(error, "Could not dismiss the suggestion."));
    } finally {
      setBusyItemId(null);
    }
  }, []);

  const itemsById = useMemo(
    () => new Map(items.map((item) => [item.id, item])),
    [items],
  );

  const chips = data.suggestions.flatMap((suggestion) => {
    const item = itemsById.get(suggestion.itemId);
    if (!item) return [];
    const left = item.positionX * zoom + position.x;
    const top = (item.positionY + item.height) * zoom + position.y + CHIP_GAP;
    if (
      left > stageSize.width ||
      top > stageSize.height ||
      left + item.width * zoom < 0 ||
      top < -40
    ) {
      return [];
    }
    return [{ suggestion, left, top }];
  });

  return (
    <>
      <Box
        sx={{
          position: "absolute",
          inset: 0,
          pointerEvents: "none",
          zIndex: 3,
        }}
      >
        {chips.map(({ suggestion, left, top }) => (
          <Paper
            key={suggestion.itemId}
            elevation={2}
            role="group"
            aria-label={`Suggested canvas ${suggestion.boardName}`}
            data-testid="home-board-suggestion"
            onPointerDown={(event) => event.stopPropagation()}
            sx={{
              position: "absolute",
              left,
              top,
              display: "flex",
              alignItems: "center",
              gap: 0.5,
              pl: 1,
              pr: 0.25,
              py: 0.25,
              maxWidth: 320,
              pointerEvents: "auto",
              borderRadius: 4,
            }}
          >
            <Tooltip title={describeReasons(suggestion.reasons)}>
              <Typography variant="caption" noWrap sx={{ minWidth: 0 }}>
                Looks like <strong>{suggestion.boardName}</strong>
              </Typography>
            </Tooltip>
            <Tooltip title={`Move to ${suggestion.boardName}`}>
              <span>
                <IconButton
                  size="small"
                  color="primary"
                  aria-label={`Accept: move to ${suggestion.boardName}`}
                  disabled={busyItemId === suggestion.itemId}
                  onClick={() => void accept(suggestion)}
                >
                  <CheckIcon fontSize="small" />
                </IconButton>
              </span>
            </Tooltip>
            <Tooltip title="Keep it here">
              <span>
                <IconButton
                  size="small"
                  aria-label="Dismiss suggestion"
                  disabled={busyItemId === suggestion.itemId}
                  onClick={() => void dismiss(suggestion)}
                >
                  <CloseIcon fontSize="small" />
                </IconButton>
              </span>
            </Tooltip>
          </Paper>
        ))}
      </Box>
      {data.recentlyFiled.length > 0 && (
        <Box sx={{ position: "absolute", left: 12, top: 12, zIndex: 4 }}>
          <Button
            size="small"
            variant="outlined"
            startIcon={<FiledIcon />}
            onClick={(event) => setMenuAnchor(event.currentTarget)}
            sx={{ bgcolor: "background.paper" }}
          >
            Filed this week ({data.recentlyFiled.length})
          </Button>
          <Menu
            anchorEl={menuAnchor}
            open={Boolean(menuAnchor)}
            onClose={() => setMenuAnchor(null)}
          >
            {data.recentlyFiled.map((entry) => (
              <MenuItem
                key={entry.itemId}
                disableRipple
                sx={{ gap: 2, cursor: "default" }}
              >
                <ListItemText
                  primary={entry.label}
                  secondary={`${entry.automatic ? "Filed automatically" : "Filed"} in ${entry.boardName}`}
                />
                <Button
                  size="small"
                  disabled={busyItemId === entry.itemId}
                  onClick={() => void undo(entry.itemId)}
                >
                  Undo
                </Button>
              </MenuItem>
            ))}
          </Menu>
        </Box>
      )}
    </>
  );
}
