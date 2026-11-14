"use client";

/**
 * IMP-141: a first step on a canvas with nothing on it.
 *
 * Ordinary page markup over the stage, never drawn on the canvas, so it is
 * not in thumbnails or exports. Only its buttons take the pointer: panning,
 * zooming and the toolbar keep working underneath and around it.
 */

import React from "react";
import { Box, Button, Stack } from "@mui/material";
import { StickyNote2Outlined } from "@mui/icons-material";
import { EmptyState } from "@/components/layout/EmptyState";

/** Room kept free for the bottom "Add to canvas" toolbar, in pixels. */
const TOOLBAR_SPACE_PX = 88;

/**
 * Shown on the free-layout board, outside presentation mode, once the first
 * load of items has answered and the canvas holds none. Before that answer
 * the count reads 0 on every canvas, and the hint must not flash.
 */
export function showsCanvasEmptyHint({
  viewMode,
  presenting,
  itemsLoaded,
  itemCount,
}: {
  viewMode: "manual" | "organizer";
  presenting: boolean;
  itemsLoaded: boolean;
  itemCount: number;
}): boolean {
  return viewMode === "manual" && !presenting && itemsLoaded && itemCount === 0;
}

export interface CanvasEmptyHintProps {
  canEdit: boolean;
  onAddNote: () => void;
  onAddLink: () => void;
}

export function CanvasEmptyHint({
  canEdit,
  onAddNote,
  onAddLink,
}: CanvasEmptyHintProps) {
  return (
    <Box
      sx={{
        position: "absolute",
        top: 0,
        left: 0,
        right: 0,
        // Centred in the space above the bottom toolbar.
        bottom: TOOLBAR_SPACE_PX,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        px: 2,
        pointerEvents: "none",
        zIndex: 1,
      }}
    >
      <Box
        sx={{
          width: "100%",
          maxWidth: 360,
          bgcolor: "background.paper",
          borderRadius: 4,
        }}
      >
        {canEdit ? (
          <EmptyState
            icon={StickyNote2Outlined}
            title="Start anywhere"
            description="Add a note or a link, then drag it wherever you like."
            action={
              <Stack
                direction="row"
                spacing={1}
                sx={{ justifyContent: "center" }}
              >
                <Button
                  variant="contained"
                  onClick={onAddNote}
                  sx={{ pointerEvents: "auto" }}
                >
                  Add a note
                </Button>
                <Button
                  variant="outlined"
                  onClick={onAddLink}
                  sx={{ pointerEvents: "auto" }}
                >
                  Add a link
                </Button>
              </Stack>
            }
          />
        ) : (
          <EmptyState
            icon={StickyNote2Outlined}
            title="Nothing here yet"
            description="Nothing has been added to this canvas."
          />
        )}
      </Box>
    </Box>
  );
}
