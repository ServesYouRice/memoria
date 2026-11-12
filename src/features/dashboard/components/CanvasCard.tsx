"use client";

import React, { useState } from "react";
import {
  Box,
  Card,
  CardActionArea,
  CardContent,
  Skeleton,
  Typography,
} from "@mui/material";

/** Placeholder colours for cards without a preview, picked by name. */
const PLACEHOLDER_COLORS = [
  "primary",
  "secondary",
  "info",
  "success",
  "warning",
  "error",
] as const;

export function placeholderFor(name: string) {
  const trimmed = name.trim();
  let hash = 0;
  for (const char of trimmed) hash = (hash * 31 + char.codePointAt(0)!) | 0;
  return {
    initial: (Array.from(trimmed)[0] ?? "?").toLocaleUpperCase(),
    color: PLACEHOLDER_COLORS[Math.abs(hash) % PLACEHOLDER_COLORS.length]!,
  };
}

export interface CanvasCardProps {
  name: string;
  thumbnail?: string | null;
  /** Secondary line under the name (e.g. "Updated 2 days ago"). */
  meta?: React.ReactNode;
  /** Chips/badges rendered over the thumbnail (e.g. role). */
  badge?: React.ReactNode;
  /** Overlay control rendered in the top-right corner (menu button, checkbox…). */
  corner?: React.ReactNode;
  selected?: boolean;
  onClick?: (event: React.MouseEvent) => void;
  index?: number;
}

/** Canvas preview card shared by the dashboard, shared-with-me, and workspace views. */
export function CanvasCard({
  name,
  thumbnail,
  meta,
  badge,
  corner,
  selected = false,
  onClick,
  index = 0,
}: CanvasCardProps) {
  const [imageError, setImageError] = useState(false);
  const placeholder = placeholderFor(name);
  const showPreview = Boolean(thumbnail) && !imageError;

  return (
    <Card
      sx={{
        height: "100%",
        position: "relative",
        animation: `fadeIn 0.4s ease-out ${Math.min(index * 0.04, 0.4)}s both`,
        ...(selected && {
          borderColor: "primary.main",
          boxShadow: (theme) => `0 0 0 1px ${theme.palette.primary.main}`,
        }),
      }}
    >
      {corner && (
        <Box sx={{ position: "absolute", top: 8, right: 8, zIndex: 2 }}>
          {corner}
        </Box>
      )}
      {badge && (
        <Box sx={{ position: "absolute", top: 8, left: 8, zIndex: 2 }}>
          {badge}
        </Box>
      )}
      <CardActionArea
        onClick={onClick}
        sx={{
          height: "100%",
          display: "flex",
          flexDirection: "column",
          alignItems: "stretch",
        }}
      >
        <Box
          sx={{
            height: 150,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            overflow: "hidden",
            bgcolor: showPreview
              ? "action.hover"
              : (theme) =>
                  // color-mix works with the CSS-variable theme in both modes.
                  `color-mix(in srgb, ${
                    (theme.vars ?? theme).palette[placeholder.color].main
                  } 14%, transparent)`,
          }}
        >
          {showPreview ? (
            <Box
              component="img"
              src={thumbnail ?? undefined}
              alt=""
              onError={() => setImageError(true)}
              sx={{ width: "100%", height: "100%", objectFit: "cover" }}
            />
          ) : (
            <Typography
              aria-hidden
              data-testid="canvas-card-placeholder"
              sx={{
                fontSize: 56,
                fontWeight: 700,
                lineHeight: 1,
                color: `${placeholder.color}.main`,
              }}
            >
              {placeholder.initial}
            </Typography>
          )}
        </Box>
        <CardContent sx={{ flexGrow: 1, width: "100%", py: 1.5 }}>
          <Typography
            variant="subtitle1"
            noWrap
            sx={{
              fontWeight: 600,
            }}
          >
            {name}
          </Typography>
          {meta && (
            <Typography
              variant="caption"
              component="div"
              noWrap
              sx={{
                color: "text.secondary",
              }}
            >
              {meta}
            </Typography>
          )}
        </CardContent>
      </CardActionArea>
    </Card>
  );
}

/** Matching skeleton for loading grids. */
export function CanvasCardSkeleton({ index = 0 }: { index?: number }) {
  return (
    <Card
      sx={{
        height: "100%",
        animation: `fadeIn 0.4s ease-out ${index * 0.06}s both`,
      }}
    >
      <Skeleton variant="rectangular" height={150} />
      <CardContent sx={{ py: 1.5 }}>
        <Skeleton width="70%" height={26} sx={{ mb: 0.5 }} />
        <Skeleton width="40%" height={16} />
      </CardContent>
    </Card>
  );
}

/** Responsive card grid wrapper (CSS grid, no deprecated MUI Grid). */
export function CardGrid({ children }: { children: React.ReactNode }) {
  return (
    <Box
      sx={{
        display: "grid",
        gridTemplateColumns: {
          xs: "1fr",
          sm: "repeat(2, 1fr)",
          md: "repeat(auto-fill, minmax(240px, 1fr))",
        },
        gap: 2.5,
      }}
    >
      {children}
    </Box>
  );
}
