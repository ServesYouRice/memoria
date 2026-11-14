"use client";

/**
 * IMP-130 — the "Organised list" tab: every item on the canvas as a list that
 * can be filtered and sorted in the browser, with the AI organiser underneath
 * in a closed section. Filtering and sorting only reorder the items already
 * loaded; nothing here calls the server.
 */

import React, { useMemo, useState } from "react";
import {
  Accordion,
  AccordionDetails,
  AccordionSummary,
  Box,
  Button,
  MenuItem,
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import { ExpandMore as ExpandMoreIcon } from "@mui/icons-material";
import {
  CanvasItemListView,
  describeItemHeading,
  type CanvasItemListViewProps,
} from "@/features/canvas/components/CanvasItemListView";
import { CanvasOrganizerView } from "@/features/canvas/components/CanvasOrganizerView";
import type { CanvasItem } from "@/types/canvas";

type SortKey = "updated" | "oldest" | "name" | "type";

const SORT_OPTIONS: { value: SortKey; label: string }[] = [
  { value: "updated", label: "Recently updated" },
  { value: "oldest", label: "Oldest first" },
  { value: "name", label: "Name A to Z" },
  { value: "type", label: "Type" },
];

const ALL_TYPES = "ALL";

export interface CanvasOrganisedListProps extends CanvasItemListViewProps {
  canvasId: string;
  itemCount: number;
}

function time(value: Date | string | undefined): number {
  const parsed = value ? new Date(value).getTime() : 0;
  return Number.isNaN(parsed) ? 0 : parsed;
}

function compareHeadings(a: CanvasItem, b: CanvasItem): number {
  return describeItemHeading(a).localeCompare(describeItemHeading(b));
}

export function sortCanvasItems(
  items: CanvasItem[],
  sortKey: SortKey,
): CanvasItem[] {
  const sorted = [...items];
  switch (sortKey) {
    case "updated":
      return sorted.sort((a, b) => time(b.updatedAt) - time(a.updatedAt));
    case "oldest":
      return sorted.sort((a, b) => time(a.createdAt) - time(b.createdAt));
    case "name":
      return sorted.sort(compareHeadings);
    case "type":
      return sorted.sort(
        (a, b) => a.type.localeCompare(b.type) || compareHeadings(a, b),
      );
  }
}

export function filterCanvasItems(
  items: CanvasItem[],
  text: string,
  type: string,
): CanvasItem[] {
  const needle = text.trim().toLowerCase();
  return items.filter((item) => {
    if (type !== ALL_TYPES && item.type !== type) return false;
    if (!needle) return true;
    return (
      describeItemHeading(item).toLowerCase().includes(needle) ||
      item.tags.some((tag) => tag.toLowerCase().includes(needle))
    );
  });
}

export function CanvasOrganisedList({
  canvasId,
  itemCount,
  items,
  ...listProps
}: CanvasOrganisedListProps) {
  const [filterText, setFilterText] = useState("");
  const [typeFilter, setTypeFilter] = useState(ALL_TYPES);
  const [sortKey, setSortKey] = useState<SortKey>("updated");

  const presentTypes = useMemo(
    () => Array.from(new Set(items.map((item) => item.type))).sort(),
    [items],
  );
  // A type that no longer has items (deleted meanwhile) falls back to all.
  const activeType = presentTypes.some((type) => type === typeFilter)
    ? typeFilter
    : ALL_TYPES;

  const visibleItems = useMemo(
    () =>
      sortCanvasItems(
        filterCanvasItems(items, filterText, activeType),
        sortKey,
      ),
    [items, filterText, activeType, sortKey],
  );

  const isFiltering = filterText.trim() !== "" || activeType !== ALL_TYPES;
  const nothingMatches = items.length > 0 && visibleItems.length === 0;

  const clearFilter = () => {
    setFilterText("");
    setTypeFilter(ALL_TYPES);
  };

  return (
    <Box sx={{ flexGrow: 1, overflow: "auto", px: { xs: 1, sm: 2 }, py: 1 }}>
      <Stack
        direction={{ xs: "column", sm: "row" }}
        spacing={1.5}
        sx={{ alignItems: { sm: "center" }, pt: 1, px: 2 }}
      >
        <TextField
          label="Filter items"
          size="small"
          value={filterText}
          onChange={(event) => setFilterText(event.target.value)}
          sx={{ minWidth: { sm: 240 } }}
        />
        <TextField
          select
          label="Type"
          size="small"
          value={activeType}
          onChange={(event) => setTypeFilter(event.target.value)}
          sx={{ minWidth: 160 }}
        >
          <MenuItem value={ALL_TYPES}>All types</MenuItem>
          {presentTypes.map((type) => (
            <MenuItem key={type} value={type}>
              {type.toLowerCase()}
            </MenuItem>
          ))}
        </TextField>
        <TextField
          select
          label="Sort by"
          size="small"
          value={sortKey}
          onChange={(event) => setSortKey(event.target.value as SortKey)}
          sx={{ minWidth: 180 }}
        >
          {SORT_OPTIONS.map((option) => (
            <MenuItem key={option.value} value={option.value}>
              {option.label}
            </MenuItem>
          ))}
        </TextField>
        <Typography
          role="status"
          variant="body2"
          sx={{ color: "text.secondary" }}
        >
          Showing {visibleItems.length} of {items.length} items
        </Typography>
      </Stack>

      {nothingMatches ? (
        <Stack spacing={1} sx={{ alignItems: "flex-start", p: 2 }}>
          <Typography>No items match.</Typography>
          <Button size="small" variant="outlined" onClick={clearFilter}>
            Clear filter
          </Button>
        </Stack>
      ) : (
        <CanvasItemListView
          {...listProps}
          items={visibleItems}
          totalItems={isFiltering ? visibleItems.length : itemCount}
        />
      )}

      {/* Closed by default and not mounted until opened, so the organiser's
          own requests wait until someone asks for it. */}
      <Accordion
        disableGutters
        slotProps={{ transition: { unmountOnExit: true } }}
        sx={{ mx: 2, mb: 2 }}
      >
        <AccordionSummary expandIcon={<ExpandMoreIcon />}>
          <Typography component="h2" variant="subtitle1">
            AI organiser
          </Typography>
        </AccordionSummary>
        <AccordionDetails>
          <CanvasOrganizerView
            canvasId={canvasId}
            items={items}
            itemCount={itemCount}
          />
        </AccordionDetails>
      </Accordion>
    </Box>
  );
}
