"use client";

import React from "react";
import {
  Drawer,
  Box,
  Typography,
  Chip,
  Stack,
  IconButton,
  Divider,
  Button,
  Badge,
} from "@mui/material";
import {
  Close as CloseIcon,
  FilterList as FilterIcon,
} from "@mui/icons-material";

export interface TagFilterPanelProps {
  open: boolean;
  onClose: () => void;
  allTags: string[];
  selectedTags: string[];
  onTagsChange: (tags: string[]) => void;
  tagCounts: Record<string, number>;
}

export function TagFilterPanel({
  open,
  onClose,
  allTags,
  selectedTags,
  onTagsChange,
  tagCounts,
}: TagFilterPanelProps) {
  const handleTagClick = (tag: string) => {
    if (selectedTags.includes(tag)) {
      onTagsChange(selectedTags.filter((t) => t !== tag));
    } else {
      onTagsChange([...selectedTags, tag]);
    }
  };

  const handleClearAll = () => {
    onTagsChange([]);
  };

  const sortedTags = [...allTags].sort((a, b) => {
    const countA = tagCounts[a] || 0;
    const countB = tagCounts[b] || 0;
    return countB - countA; // Sort by count descending
  });

  return (
    <Drawer
      anchor="right"
      open={open}
      onClose={onClose}
      sx={{
        "& .MuiDrawer-paper": {
          width: 300,
          p: 2,
        },
      }}
    >
      <Box
        sx={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          mb: 2,
        }}
      >
        <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
          <FilterIcon />
          <Typography variant="h6">Filter by Tags</Typography>
        </Box>
        <IconButton onClick={onClose} size="small">
          <CloseIcon />
        </IconButton>
      </Box>

      <Divider sx={{ mb: 2 }} />

      {selectedTags.length > 0 && (
        <Box sx={{ mb: 2 }}>
          <Box
            sx={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              mb: 1,
            }}
          >
            <Typography
              variant="subtitle2"
              sx={{
                color: "text.secondary",
              }}
            >
              Active Filters ({selectedTags.length})
            </Typography>
            <Button size="small" onClick={handleClearAll}>
              Clear All
            </Button>
          </Box>
          <Stack
            direction="row"
            spacing={1}
            sx={{
              flexWrap: "wrap",
              gap: 1,
            }}
          >
            {selectedTags.map((tag) => (
              <Chip
                key={tag}
                label={tag}
                onDelete={() => handleTagClick(tag)}
                color="primary"
                size="small"
              />
            ))}
          </Stack>
          <Divider sx={{ mt: 2, mb: 2 }} />
        </Box>
      )}

      <Typography
        variant="subtitle2"
        sx={{
          color: "text.secondary",
          mb: 1,
        }}
      >
        Available Tags ({allTags.length})
      </Typography>

      {allTags.length === 0 ? (
        <Typography
          variant="body2"
          sx={{
            color: "text.secondary",
            fontStyle: "italic",
          }}
        >
          No tags yet. Add tags to your notes and bookmarks to organize them.
        </Typography>
      ) : (
        <Stack spacing={1}>
          {sortedTags.map((tag) => {
            const isSelected = selectedTags.includes(tag);
            const count = tagCounts[tag] || 0;

            return (
              <Badge
                key={tag}
                badgeContent={count}
                color="default"
                sx={{
                  "& .MuiBadge-badge": {
                    right: 8,
                    top: "50%",
                    transform: "translateY(-50%)",
                  },
                }}
              >
                <Chip
                  label={tag}
                  onClick={() => handleTagClick(tag)}
                  variant={isSelected ? "filled" : "outlined"}
                  color={isSelected ? "primary" : "default"}
                  sx={{
                    width: "100%",
                    justifyContent: "flex-start",
                    pr: 4,
                  }}
                />
              </Badge>
            );
          })}
        </Stack>
      )}
    </Drawer>
  );
}
