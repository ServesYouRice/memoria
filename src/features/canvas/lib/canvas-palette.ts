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
  /** Frame background and body tint when the frame has no stored colour. */
  frameFill: string;
  frameBodyTint: string;
  note: { fill: string; stroke: string; text: string };
  bookmark: {
    fill: string;
    stroke: string;
    text: string;
    link: string;
    footerBg: string;
  };
  imageError: string;
  /** Dark scrim with white text, drawn over images and the camera feed. */
  scrim: string;
  scrimText: string;
  shadow: string;
  /** Diffused card shadow opacity per mode. */
  cardShadowOpacity: number;
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
    text: "#1c2452",
    textBody: "#334155",
    textMuted: "#55607a",
    textFaint: "#8592a6",
    accentSoft: "#dbeafe",
    accentSofter: "#eff6ff",
    accentText: "#1d4ed8",
    ink: "#0f172a",
    frameFill: "#eef2f8",
    frameBodyTint: "rgba(255, 255, 255, 0.48)",
    note: { fill: "#FEF6C8", stroke: "#E6D273", text: "#3A311E" },
    bookmark: {
      fill: "#ffffff",
      stroke: "#dce3ee",
      text: "#1c2452",
      link: brand.primary.main,
      footerBg: "#f8fafc",
    },
    imageError: "#b3261e",
    scrim: "rgba(15, 23, 42, 0.72)",
    scrimText: "#ffffff",
    shadow: "rgba(15, 23, 42, 0.25)",
    cardShadowOpacity: 0.12,
    grid: appColorTokens.light.canvasGrid,
    dot: appColorTokens.light.canvasDot,
  },
  dark: {
    selection: brand.primary.light,
    selectionFill: "rgba(147, 197, 253, 0.16)",
    surface: "#152038",
    surfaceSubtle: "#1b2845",
    border: "#2a3b5c",
    borderStrong: "#3b5078",
    text: "#f1f5f9",
    textBody: "#dbe3ef",
    textMuted: "#a3aec2",
    textFaint: "#7d8aa3",
    accentSoft: "#1e3a66",
    accentSofter: "#172b4d",
    accentText: "#bfdbfe",
    ink: "#e2e8f0",
    frameFill: "#141f36",
    frameBodyTint: "rgba(21, 32, 56, 0.42)",
    note: { fill: "#2E2816", stroke: "#8A7228", text: "#FEF3C7" },
    bookmark: {
      fill: "#152038",
      stroke: "#2b3d60",
      text: "#f1f5f9",
      link: "#93c5fd",
      footerBg: "#111a2e",
    },
    imageError: "#fda4af",
    scrim: "rgba(11, 17, 32, 0.78)",
    scrimText: "#ffffff",
    shadow: "rgba(0, 0, 0, 0.55)",
    cardShadowOpacity: 0.36,
    grid: appColorTokens.dark.canvasGrid,
    dot: appColorTokens.dark.canvasDot,
  },
};

/** The canvas palette for the current light/dark mode. */
export function useCanvasPalette(): CanvasPalette {
  return CANVAS_PALETTE[useThemeMode().mode];
}
