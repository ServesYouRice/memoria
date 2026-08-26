"use client";

import { Box, Typography } from "@mui/material";
import {
  collaborationColorForUser,
  cursorIdentityVariant,
} from "@/lib/collaboration/transport-policy";

interface RemoteCursorProps {
  userId: string;
  name: string;
  color?: string;
  x: number;
  y: number;
}

const BORDER_STYLES = ["solid", "dashed", "dotted", "double"] as const;

/** A DOM overlay keeps remote pointers named and present in the a11y tree. */
export function RemoteCursor({ userId, name, color, x, y }: RemoteCursorProps) {
  const stableColor = color || collaborationColorForUser(userId);
  const variant = cursorIdentityVariant(userId);

  return (
    <Box
      role="img"
      aria-label={`${name}'s cursor`}
      data-user-id={userId}
      data-cursor-variant={variant}
      sx={{
        position: "absolute",
        left: x,
        top: y,
        zIndex: 900,
        pointerEvents: "none",
        transform: "translate(-2px, -2px)",
      }}
    >
      <Box
        aria-hidden="true"
        sx={{
          width: 18,
          height: 24,
          bgcolor: stableColor,
          clipPath: "polygon(0 0, 100% 70%, 58% 72%, 42% 100%)",
          filter: "drop-shadow(0 1px 1px rgba(0, 0, 0, 0.45))",
          transform: variant % 2 === 0 ? "none" : "rotate(-3deg)",
          transformOrigin: "top left",
        }}
      />
      <Typography
        aria-hidden="true"
        component="span"
        variant="caption"
        sx={{
          display: "block",
          width: "max-content",
          maxWidth: 180,
          mt: -0.5,
          ml: 1.5,
          px: 0.75,
          py: 0.125,
          border: "2px",
          borderStyle: BORDER_STYLES[variant],
          borderColor: "common.white",
          borderRadius: variant % 2 === 0 ? 1 : 0.25,
          bgcolor: stableColor,
          color: "common.white",
          fontWeight: 700,
          lineHeight: 1.4,
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
          boxShadow: 1,
        }}
      >
        {name}
      </Typography>
    </Box>
  );
}
