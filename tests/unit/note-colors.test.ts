import { describe, expect, it } from "vitest";
import {
  NOTE_COLORS,
  NOTE_PALETTE,
  noteColorsFor,
} from "@/features/canvas/lib/note-colors";
import { NOTE_COLOR_NAMES } from "@/lib/note-colors";

function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const channel = parseInt(hex.slice(i, i + 2), 16) / 255;
    return channel <= 0.03928
      ? channel / 12.92
      : ((channel + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

describe("note colours", () => {
  it("draw a note without a colour in yellow", () => {
    expect(noteColorsFor({ text: "hi" }, "light")).toBe(NOTE_COLORS.light);
    expect(noteColorsFor({ text: "hi", color: "nope" }, "dark")).toBe(
      NOTE_COLORS.dark,
    );
    expect(noteColorsFor({ text: "hi", color: "blue" }, "light")).toBe(
      NOTE_PALETTE.light.blue,
    );
  });

  it.each(
    (["light", "dark"] as const).flatMap((mode) =>
      NOTE_COLOR_NAMES.map((name) => [mode, name] as const),
    ),
  )("%s %s keeps 4.5:1+ text on its fill", (mode, name) => {
    const colors = NOTE_PALETTE[mode][name];
    expect(contrast(colors.text, colors.fill)).toBeGreaterThanOrEqual(4.5);
    if (mode === "dark") expect(luminance(colors.fill)).toBeLessThan(0.1);
    else expect(luminance(colors.fill)).toBeGreaterThan(0.6);
  });

  it("gives every colour its own fill", () => {
    for (const mode of ["light", "dark"] as const) {
      const fills = NOTE_COLOR_NAMES.map(
        (name) => NOTE_PALETTE[mode][name].fill,
      );
      expect(new Set(fills).size).toBe(fills.length);
    }
  });
});
