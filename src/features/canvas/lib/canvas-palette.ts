"use client";

import type { PaletteMode } from "@mui/material";
import { appColorTokens, brand } from "@/lib/theme";
import { useThemeMode } from "@/lib/theme-context";

/**
 * Colours for canvas items (IMP-080). Konva draws on a <canvas>, so it cannot
 * read MUI `sx` or CSS variables; it reads this palette, chosen by the
 * light/dark mode. Colours a user picks (note, drawing, shape and text
 * colours) are content and are drawn as stored; the `ink` value is only the
 * fallback when nothing was picked.
 */
export interface CanvasPalette {
  /** Selection outlines, resize handles and focus accents. */
  selection: string;
  selectionFill: string;
  /** Item card surfaces. */
  surface: string;
  surfaceSubtle: string;
  border: string;
  borderStrong: string;
  /** Text on item cards, strongest to faintest. */
  text: string;
  textBody: string;
  textMuted: string;
  textFaint: string;
  /** Soft accent fill (voted poll option, progress bar). */
  accentSoft: string;
  accentSofter: string;
  accentText: string;
  /** Default ink for drawings, arrows, shapes and text with no stored colour. */
  ink: string;
  /** Frame background when the frame has no stored colour. */
  frameFill: string;
  note: { fill: string; stroke: string; text: string };
  bookmark: { fill: string; stroke: string; text: string; link: string };
  imageError: string;
  /** Dark scrim with white text, drawn over images and the camera feed. */
  scrim: string;
  scrimText: string;
  shadow: string;
  grid: string;
  /** Faint background dots (IMP-085). */
  dot: string;
}

export const CANVAS_PALETTE: Record<PaletteMode, CanvasPalette> = {
  light: {
    selection: brand.primary.main,
    selectionFill: "rgba(44, 95, 201, 0.1)",
    surface: "#ffffff",
    surfaceSubtle: "#f8fafc",
    border: "#e2e8f0",
    borderStrong: "#cbd5e1",
    text: "#1e293b",
    textBody: "#334155",
    textMuted: "#64748b",
    textFaint: "#94a3b8",
    accentSoft: "#dbeafe",
    accentSofter: "#eff6ff",
    accentText: "#1d4ed8",
    ink: "#0f172a",
    frameFill: "#f1f5f9",
    note: { fill: "#FFFACD", stroke: "#FFD700", text: "#333333" },
    bookmark: {
      fill: "#FFF9E6",
      stroke: "#FFB74D",
      text: "#333333",
      link: "#1976D2",
    },
    imageError: "#b3261e",
    scrim: "rgba(0, 0, 0, 0.7)",
    scrimText: "#ffffff",
    shadow: "rgba(0, 0, 0, 0.35)",
    grid: appColorTokens.light.canvasGrid,
    dot: appColorTokens.light.canvasDot,
  },
  dark: {
    selection: brand.primary.light,
    selectionFill: "rgba(147, 197, 253, 0.15)",
    surface: "#16213a",
    surfaceSubtle: "#1b2742",
    border: "#2b3a57",
    borderStrong: "#3b4b6b",
    text: "#f1f5f9",
    textBody: "#dbe3ef",
    textMuted: "#a3aec2",
    textFaint: "#7d8aa3",
    accentSoft: "#1e3a66",
    accentSofter: "#172b4d",
    accentText: "#bfdbfe",
    ink: "#e2e8f0",
    frameFill: "#111a2e",
    note: { fill: "#3b3622", stroke: "#a68b2c", text: "#f5efd6" },
    bookmark: {
      fill: "#2f2a1f",
      stroke: "#b7791f",
      text: "#f5efd6",
      link: "#93c5fd",
    },
    imageError: "#fda4af",
    scrim: "rgba(0, 0, 0, 0.7)",
    scrimText: "#ffffff",
    shadow: "rgba(0, 0, 0, 0.6)",
    grid: appColorTokens.dark.canvasGrid,
    dot: appColorTokens.dark.canvasDot,
  },
};

/** The canvas palette for the current light/dark mode. */
export function useCanvasPalette(): CanvasPalette {
  return CANVAS_PALETTE[useThemeMode().mode];
}
