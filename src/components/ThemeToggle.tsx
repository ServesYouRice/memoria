"use client";

import React from "react";
import { Box, IconButton, Tooltip, type IconButtonProps } from "@mui/material";
import { Brightness4, Brightness7 } from "@mui/icons-material";
import { useThemeMode } from "@/lib/theme-context";
import { motion } from "@/lib/theme";

export function ThemeToggle(props: IconButtonProps) {
  const { mode, toggleTheme } = useThemeMode();
  const isLight = mode === "light";

  const handleToggle = () => {
    const prefersReducedMotion =
      typeof window !== "undefined" &&
      window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    const doc = document as Document & {
      startViewTransition?: (cb: () => void) => void;
    };
    if (
      !prefersReducedMotion &&
      typeof doc.startViewTransition === "function"
    ) {
      doc.startViewTransition(() => toggleTheme());
    } else {
      toggleTheme();
    }
  };

  return (
    <Tooltip title={isLight ? "Switch to dark mode" : "Switch to light mode"}>
      <IconButton
        onClick={handleToggle}
        color="inherit"
        aria-label={isLight ? "Switch to dark mode" : "Switch to light mode"}
        {...props}
      >
        <Box
          component="span"
          aria-hidden
          sx={{
            position: "relative",
            display: "inline-flex",
            width: 24,
            height: 24,
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <Brightness4
            sx={{
              position: "absolute",
              opacity: isLight ? 1 : 0,
              transform: isLight
                ? "rotate(0deg) scale(1)"
                : "rotate(-90deg) scale(0.55)",
              transition: `opacity 200ms ${motion.easeOut}, transform 280ms ${motion.springSnappy}`,
            }}
          />
          <Brightness7
            sx={{
              position: "absolute",
              opacity: isLight ? 0 : 1,
              transform: isLight
                ? "rotate(90deg) scale(0.55)"
                : "rotate(0deg) scale(1)",
              transition: `opacity 200ms ${motion.easeOut}, transform 280ms ${motion.springSnappy}`,
            }}
          />
        </Box>
      </IconButton>
    </Tooltip>
  );
}
