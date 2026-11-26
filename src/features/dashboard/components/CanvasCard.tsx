"use client";

import React, { useState } from "react";
import NextLink from "next/link";
import {
  Box,
  Card,
  CardActionArea,
  CardContent,
  Chip,
  Skeleton,
  Typography,
} from "@mui/material";
import {
  PeopleOutlined as SharedIcon,
  Public as PublicIcon,
} from "@mui/icons-material";
import { appColor, motion } from "@/lib/theme";

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
  /**
   * IMP-090: where the card leads. With it the card is a real link, so
   * Ctrl/Cmd-click, middle-click and the link menu work. Leave it out while
   * the card is a selection toggle.
   */
  href?: string;
  onClick?: (event: React.MouseEvent) => void;
  index?: number;
  /** Grid card (default) or compact horizontal list row. */
  variant?: "grid" | "list";
  /** Subtle metadata chip when the canvas has a public link enabled. */
  isPublic?: boolean;
  /** Subtle metadata chip when the canvas is shared with collaborators. */
  isShared?: boolean;
  /** Optional item count metadata chip when provided by the caller. */
  itemCount?: number;
}

/** Canvas preview card shared by the dashboard, shared-with-me, and workspace views. */
export function CanvasCard({
  name,
  thumbnail,
  meta,
  badge,
  corner,
  selected = false,
  href,
  onClick,
  index = 0,
  variant = "grid",
  isPublic = false,
  isShared = false,
  itemCount,
}: CanvasCardProps) {
  const [imageError, setImageError] = useState(false);
  const placeholder = placeholderFor(name);
  const showPreview = Boolean(thumbnail) && !imageError;
  const isList = variant === "list";
  const hasMetadataChips =
    isPublic || isShared || typeof itemCount === "number";

  const metadataChips = hasMetadataChips ? (
    <Box
      sx={{
        display: "flex",
        alignItems: "center",
        flexWrap: "wrap",
        gap: 0.75,
        mt: isList ? 0.5 : 0.75,
      }}
    >
      {typeof itemCount === "number" && (
        <Chip
          size="small"
          variant="outlined"
          label={`${itemCount} item${itemCount === 1 ? "" : "s"}`}
          sx={{
            height: 20,
            fontSize: "0.7rem",
            color: "text.secondary",
            borderColor: "divider",
          }}
        />
      )}
      {isPublic && (
        <Chip
          size="small"
          variant="outlined"
          color="primary"
          icon={<PublicIcon sx={{ fontSize: "13px !important" }} />}
          label="Public"
          sx={{
            height: 20,
            fontSize: "0.7rem",
          }}
        />
      )}
      {isShared && (
        <Chip
          size="small"
          variant="outlined"
          icon={<SharedIcon sx={{ fontSize: "13px !important" }} />}
          label="Shared"
          sx={{
            height: 20,
            fontSize: "0.7rem",
            color: "text.secondary",
            borderColor: "divider",
          }}
        />
      )}
    </Box>
  ) : null;

  return (
    <Card
      data-view={variant}
      sx={{
        height: isList ? "auto" : "100%",
        position: "relative",
        animation: `fadeIn 240ms ${motion.easeOut} ${Math.min(index * 28, 200)}ms both`,
        "@media (prefers-reduced-motion: reduce)": {
          animation: "none",
          "&:hover": {
            transform: "none",
            "& .canvas-card-thumb": {
              transform: "none",
            },
          },
        },
        "&:hover": {
          transform: isList ? "translateY(-1px)" : "translateY(-3px)",
          "& .canvas-card-thumb": {
            transform: "scale(1.035)",
          },
          "& .canvas-card-corner": {
            opacity: 1,
          },
        },
        "&:focus-within .canvas-card-corner": {
          opacity: 1,
        },
        ...(selected && {
          borderColor: "primary.main",
          boxShadow: (theme) => `0 0 0 1px ${theme.palette.primary.main}`,
        }),
      }}
    >
      {corner && (
        <Box
          className="canvas-card-corner"
          sx={{
            position: "absolute",
            top: isList ? "50%" : 8,
            right: isList ? 10 : 8,
            transform: isList ? "translateY(-50%)" : "none",
            zIndex: 2,
            opacity: selected || !href || isList ? 1 : { xs: 1, md: 0.72 },
            transition: `opacity 150ms ${motion.easeOut}`,
            "@media (pointer: coarse)": { opacity: 1 },
          }}
        >
          {corner}
        </Box>
      )}
      {badge && !isList && (
        <Box sx={{ position: "absolute", top: 8, left: 8, zIndex: 2 }}>
          {badge}
        </Box>
      )}
      <CardActionArea
        {...(href ? { component: NextLink, href } : {})}
        aria-pressed={href ? undefined : onClick ? selected : undefined}
        onClick={onClick}
        sx={{
          height: "100%",
          display: "flex",
          flexDirection: isList ? "row" : "column",
          alignItems: isList ? "center" : "stretch",
          pr: isList && corner ? 6 : 0,
        }}
      >
        <Box
          sx={{
            height: isList ? 56 : 156,
            width: isList ? 84 : "100%",
            flexShrink: 0,
            m: isList ? 1 : 0,
            borderRadius: isList ? 1.5 : 0,
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
                  } 12%, transparent)`,
            ...(!showPreview && {
              backgroundImage: `radial-gradient(${appColor("canvasDot")} 1.1px, transparent 1.1px)`,
              backgroundSize: "16px 16px",
            }),
          }}
        >
          {showPreview ? (
            <Box
              component="img"
              className="canvas-card-thumb"
              src={thumbnail ?? undefined}
              alt=""
              onError={() => setImageError(true)}
              sx={{
                width: "100%",
                height: "100%",
                objectFit: "cover",
                transition: `transform 300ms ${motion.springGentle}`,
              }}
            />
          ) : (
            <Typography
              aria-hidden
              data-testid="canvas-card-placeholder"
              sx={{
                fontSize: isList ? 24 : 52,
                fontWeight: 700,
                lineHeight: 1,
                color: `${placeholder.color}.main`,
                transition: `transform 260ms ${motion.springSnappy}`,
              }}
            >
              {placeholder.initial}
            </Typography>
          )}
        </Box>
        <CardContent
          sx={{
            flexGrow: 1,
            minWidth: 0,
            width: isList ? "auto" : "100%",
            py: isList ? 1 : 1.5,
            px: isList ? 1.5 : 2,
            "&:last-child": { pb: isList ? 1 : 1.5 },
          }}
        >
          <Box
            sx={{
              display: "flex",
              alignItems: "center",
              gap: 1,
              minWidth: 0,
            }}
          >
            <Typography
              variant="subtitle1"
              noWrap
              sx={{
                fontWeight: 600,
              }}
            >
              {name}
            </Typography>
            {badge && isList && <Box sx={{ flexShrink: 0 }}>{badge}</Box>}
          </Box>
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
          {metadataChips}
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
        "@media (prefers-reduced-motion: reduce)": {
          animation: "none",
        },
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
