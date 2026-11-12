import type { PaletteMode } from "@mui/material";

export interface NoteColors {
  fill: string;
  stroke: string;
  text: string;
}

/**
 * Note colours per theme mode. Konva draws on a canvas, so it needs real
 * colour values rather than CSS variables. The dark fill is a soft, muted
 * yellow; its text keeps well above 4.5:1 contrast.
 */
export const NOTE_COLORS: Record<PaletteMode, NoteColors> = {
  light: { fill: "#FFFACD", stroke: "#FFD700", text: "#333333" },
  dark: { fill: "#3b3622", stroke: "#a68b2c", text: "#f5efd6" },
};

/** Read-only/shared view keeps its own light palette, darkened in dark mode. */
export const READONLY_NOTE_COLORS: Record<PaletteMode, NoteColors> = {
  light: { fill: "#fffacd", stroke: "#facc15", text: "#334155" },
  dark: NOTE_COLORS.dark,
};
