"use client";

import React from "react";
import { Box, Typography, alpha } from "@mui/material";
import type { SvgIconComponent } from "@mui/icons-material";

export interface EmptyStateProps {
  icon: SvgIconComponent;
  title: string;
  description?: string;
  /** Optional call-to-action button. */
  action?: React.ReactNode;
}

/** Standard empty state: soft icon badge, title, description, optional CTA. */
export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
}: EmptyStateProps) {
  return (
    <Box
      sx={{
        textAlign: "center",
        py: 8,
        px: 4,
        borderRadius: 4,
        border: "1px dashed",
        borderColor: "divider",
        animation: "fadeIn 0.4s ease-out",
      }}
    >
      <Box
        sx={{
          width: 72,
          height: 72,
          borderRadius: "50%",
          bgcolor: (theme) => alpha(theme.palette.primary.main, 0.1),
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          mx: "auto",
          mb: 2.5,
        }}
      >
        <Icon sx={{ fontSize: 36, color: "primary.main" }} />
      </Box>
      <Typography
        variant="h6"
        gutterBottom
        sx={{
          fontWeight: 600,
        }}
      >
        {title}
      </Typography>
      {description && (
        <Typography
          variant="body2"
          sx={{
            color: "text.secondary",
            maxWidth: 420,
            mx: "auto",
            mb: action ? 3 : 0,
          }}
        >
          {description}
        </Typography>
      )}
      {action}
    </Box>
  );
}
