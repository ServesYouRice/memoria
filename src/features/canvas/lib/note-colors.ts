import type { PaletteMode } from "@mui/material";
import {
  DEFAULT_NOTE_COLOR,
  NOTE_COLOR_NAMES,
  noteColorOf,
  type NoteColorName,
} from "@/lib/note-colors";
import { fonts } from "@/lib/theme";

export interface NoteColors {
  fill: string;
  /** A slightly deeper edge of the same colour. */
  stroke: string;
  text: string;
}

/**
 * Sticky-note colours per theme mode (IMP-085). Konva draws on a canvas, so it
 * needs real colour values rather than CSS variables. Dark fills are soft and
 * muted; every text colour keeps well above 4.5:1 contrast on its fill.
 */
export const NOTE_PALETTE: Record<
  PaletteMode,
  Record<NoteColorName, NoteColors>
> = {
  light: {
    yellow: { fill: "#FFF3B0", stroke: "#E6CF62", text: "#3D3524" },
    pink: { fill: "#FFDCE5", stroke: "#EEA9BB", text: "#4A2630" },
    blue: { fill: "#D9E9FF", stroke: "#9CC0EE", text: "#1F3150" },
    green: { fill: "#DAF2D6", stroke: "#9DD398", text: "#213D22" },
    purple: { fill: "#E9E0FB", stroke: "#BAA5EC", text: "#33284D" },
    orange: { fill: "#FFE2C7", stroke: "#F0B07A", text: "#4A2E17" },
  },
  dark: {
    yellow: { fill: "#3B3622", stroke: "#6B5F2E", text: "#F5EFD6" },
    pink: { fill: "#3D2530", stroke: "#6E3F52", text: "#F8DFE7" },
    blue: { fill: "#1F2D42", stroke: "#3A5577", text: "#DCE9FB" },
    green: { fill: "#213326", stroke: "#3C6045", text: "#DCF1DE" },
    purple: { fill: "#2C2640", stroke: "#50457A", text: "#E8E1FA" },
    orange: { fill: "#3D2C1E", stroke: "#6E4D30", text: "#FBE5D0" },
  },
};

/** Default (yellow) colours per mode. */
export const NOTE_COLORS: Record<PaletteMode, NoteColors> = {
  light: NOTE_PALETTE.light[DEFAULT_NOTE_COLOR],
  dark: NOTE_PALETTE.dark[DEFAULT_NOTE_COLOR],
};

/** The colours a stored note is drawn in, in this theme mode. */
export function noteColorsFor(content: unknown, mode: PaletteMode): NoteColors {
  return NOTE_PALETTE[mode][noteColorOf(content)];
}

/** Names people see in the colour picker. */
export const NOTE_COLOR_LABELS: Record<NoteColorName, string> = {
  yellow: "Yellow",
  pink: "Pink",
  blue: "Blue",
  green: "Green",
  purple: "Purple",
  orange: "Orange",
};

export { NOTE_COLOR_NAMES };

/**
 * The shared sticky-note look: the editor, the read-only view, previews and
 * exports all draw notes with these values.
 */
export const NOTE_STYLE = {
  cornerRadius: 10,
  padding: 16,
  fontSize: 15,
  lineHeight: 1.4,
  fontFamily: fonts.body,
  strokeWidth: 1,
  selectedStrokeWidth: 2.5,
  shadowBlur: 14,
  shadowOffset: { x: 0, y: 4 },
  shadowOpacity: { light: 0.16, dark: 0.45 },
} as const;
