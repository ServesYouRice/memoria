"use client";

import React from "react";
import {
  Box,
  List,
  ListItemButton,
  ListItemText,
  Typography,
} from "@mui/material";
import type { CanvasItem } from "@/types/canvas";
import { getItemTitle } from "@/lib/agents/item-text";
import { linksOf } from "@/features/canvas/lib/arrow-attachment";

/**
 * "Linked to" (IMP-095): what the selected item is joined to by arrows, with
 * a click to jump there. Shown only when the item has links.
 */
export function LinkedItemsPanel({
  itemId,
  items,
  onJump,
}: {
  itemId: string;
  items: readonly CanvasItem[];
  onJump: (item: CanvasItem) => void;
}) {
  const links = React.useMemo(() => linksOf(itemId, items), [itemId, items]);
  if (links.length === 0) return null;
  return (
    <Box
      component="section"
      aria-label="Linked items"
      sx={{
        bgcolor: "background.paper",
        border: 1,
        borderColor: "divider",
        borderRadius: 2,
        boxShadow: 2,
        width: 260,
        maxHeight: 280,
        overflowY: "auto",
        py: 1,
      }}
    >
      <Typography variant="overline" sx={{ px: 2, color: "text.secondary" }}>
        Linked to
      </Typography>
      <List dense disablePadding>
        {links.map((link) => (
          <ListItemButton key={link.arrowId} onClick={() => onJump(link.item)}>
            <ListItemText
              primary={`${link.direction === "to" ? "→" : "←"} ${getItemTitle(link.item)}`}
              secondary={link.label}
              slotProps={{ primary: { noWrap: true } }}
            />
          </ListItemButton>
        ))}
      </List>
    </Box>
  );
}
