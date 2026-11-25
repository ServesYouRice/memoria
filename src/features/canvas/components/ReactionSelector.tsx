"use client";

import React from "react";
import { Paper, IconButton, Box } from "@mui/material";
import { prefersReducedMotion } from "@/features/canvas/lib/canvas-motion";
import { appColor, motion } from "@/lib/theme";

const REACTIONS = ["👍", "❤️", "🔥", "😂", "😮", "🎉"];
const STAGGER_MS = 20;

interface ReactionSelectorProps {
  x: number;
  y: number;
  onSelect: (emoji: string) => void;
  onClose: () => void;
}

export const ReactionSelector: React.FC<ReactionSelectorProps> = ({
  x,
  y,
  onSelect,
  onClose,
}) => {
  const reducedMotion = prefersReducedMotion();

  return (
    <Box
      sx={{
        position: "absolute",
        left: x,
        top: y,
        zIndex: 1000,
      }}
      onMouseLeave={onClose}
    >
      <Paper
        elevation={0}
        sx={{
          p: 0.75,
          display: "flex",
          gap: 0.25,
          borderRadius: 999,
          bgcolor: appColor("floatingSurface"),
          backdropFilter: "blur(12px)",
          border: `1px solid ${appColor("floatingBorder")}`,
          boxShadow: appColor("floatingShadow"),
          animation: reducedMotion
            ? "none"
            : `toolbarIn 180ms ${motion.springSnappy}`,
          "@media (prefers-reduced-motion: reduce)": {
            animation: "none",
          },
        }}
      >
        {REACTIONS.map((emoji, index) => (
          <IconButton
            key={emoji}
            size="small"
            aria-label={`React with ${emoji}`}
            data-stagger-ms={reducedMotion ? 0 : index * STAGGER_MS}
            onClick={(e) => {
              e.stopPropagation();
              onSelect(emoji);
              onClose();
            }}
            sx={{
              fontSize: "1.25rem",
              width: 38,
              height: 38,
              animation: reducedMotion
                ? "none"
                : `popIn 240ms ${motion.springSnappy} ${index * STAGGER_MS}ms both`,
              transition: reducedMotion
                ? "none"
                : `transform 200ms ${motion.springSnappy}, background-color 140ms ease`,
              "&:hover": {
                transform: reducedMotion
                  ? "none"
                  : "scale(1.34) translateY(-4px)",
                bgcolor: "action.hover",
              },
              "@media (prefers-reduced-motion: reduce)": {
                animation: "none",
                transition: "none",
                "&:hover": {
                  transform: "none",
                },
              },
            }}
          >
            {emoji}
          </IconButton>
        ))}
      </Paper>
    </Box>
  );
};
