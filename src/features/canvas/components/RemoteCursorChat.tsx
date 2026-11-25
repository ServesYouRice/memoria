"use client";

import React from "react";
import { Box, Paper, Typography } from "@mui/material";
import { CANVAS_PALETTE } from "@/features/canvas/lib/canvas-palette";
import { prefersReducedMotion } from "@/features/canvas/lib/canvas-motion";
import { motion } from "@/lib/theme";

const DEFAULT_TTL_MS = 5000;
const EXIT_DURATION_MS = 400;

interface RemoteCursorChatProps {
  x: number;
  y: number;
  message: string;
  senderName: string;
  color: string;
  ttlMs?: number;
}

export const RemoteCursorChat: React.FC<RemoteCursorChatProps> = ({
  x,
  y,
  message,
  senderName,
  color,
  ttlMs = DEFAULT_TTL_MS,
}) => {
  const [exiting, setExiting] = React.useState(false);
  const reducedMotion = prefersReducedMotion();

  React.useEffect(() => {
    setExiting(false);
    const exitDelay = Math.max(0, ttlMs - EXIT_DURATION_MS);
    const timer = window.setTimeout(() => {
      setExiting(true);
    }, exitDelay);
    return () => window.clearTimeout(timer);
  }, [ttlMs]);

  return (
    <Box
      sx={{
        position: "absolute",
        left: x,
        top: y,
        zIndex: 1000,
        pointerEvents: "none", // Don't block clicks
        transform: "translateY(-100%)", // Show above cursor
      }}
    >
      <Box
        data-exiting={exiting ? "true" : "false"}
        sx={{
          transformOrigin: "bottom left",
          opacity: exiting ? 0 : 1,
          transform:
            exiting && !reducedMotion
              ? "scale(0.84) translateY(4px)"
              : "scale(1) translateY(0)",
          transition: reducedMotion
            ? "none"
            : `opacity ${EXIT_DURATION_MS}ms ${motion.easeIn}, transform ${EXIT_DURATION_MS}ms ${motion.easeIn}`,
          "@media (prefers-reduced-motion: reduce)": {
            transition: "none",
            transform: "none",
          },
        }}
      >
        <Paper
          elevation={3}
          sx={{
            px: 1.5,
            py: 1,
            borderRadius: "14px 14px 14px 2px",
            backgroundColor: color,
            color: "common.white",
            maxWidth: 260,
            transformOrigin: "bottom left",
            animation: reducedMotion
              ? "none"
              : `bubblePop 240ms ${motion.springSnappy}`,
            "@media (prefers-reduced-motion: reduce)": {
              animation: "none",
            },
            mt: -1,
          }}
        >
          <Typography variant="body2" sx={{ fontWeight: 500 }}>
            {message}
          </Typography>
        </Paper>
        <Typography
          variant="caption"
          sx={{
            color: color,
            fontWeight: 600,
            textShadow: `0 1px 2px ${CANVAS_PALETTE.light.shadow}`,
            ml: 1,
          }}
        >
          {senderName}
        </Typography>
      </Box>
    </Box>
  );
};
