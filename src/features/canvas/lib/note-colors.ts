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
    yellow: { fill: "#FEF6C8", stroke: "#E6D273", text: "#3A311E" },
    pink: { fill: "#FFE1EA", stroke: "#EFAFC2", text: "#4A2230" },
    blue: { fill: "#DCEBFF", stroke: "#9FC1EE", text: "#1C3052" },
    green: { fill: "#DCF4DC", stroke: "#9CD2A0", text: "#1E3B22" },
    purple: { fill: "#ECE3FC", stroke: "#BEA9EC", text: "#31244D" },
    orange: { fill: "#FFE6CE", stroke: "#EEB480", text: "#4A2B14" },
  },
  dark: {
    yellow: { fill: "#2E2816", stroke: "#8A7228", text: "#FEF3C7" },
    pink: { fill: "#351929", stroke: "#9E3E66", text: "#FCE7F3" },
    blue: { fill: "#162744", stroke: "#3B6EB5", text: "#DBEAFE" },
    green: { fill: "#162D24", stroke: "#2E7A5B", text: "#D1FAE5" },
    purple: { fill: "#241D3D", stroke: "#6A55B8", text: "#EDE9FE" },
    orange: { fill: "#362114", stroke: "#A35829", text: "#FFEDD5" },
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
  cornerRadius: 12,
  padding: 16,
  fontSize: 15,
  lineHeight: 1.45,
  fontFamily: fonts.body,
  strokeWidth: 1,
  selectedStrokeWidth: 2,
  shadowBlur: 16,
  shadowOffset: { x: 0, y: 4 },
  shadowOpacity: { light: 0.13, dark: 0.4 },
} as const;
