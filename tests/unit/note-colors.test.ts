import { describe, expect, it } from "vitest";
import {
  NOTE_COLORS,
  READONLY_NOTE_COLORS,
} from "@/features/canvas/lib/note-colors";

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
  it("keep the daytime yellow in light mode", () => {
    expect(NOTE_COLORS.light.fill).toBe("#FFFACD");
    expect(READONLY_NOTE_COLORS.light.fill).toBe("#fffacd");
  });

  it.each([
    ["editor", NOTE_COLORS.dark],
    ["read-only view", READONLY_NOTE_COLORS.dark],
  ])("use a soft dark fill with 4.5:1+ text in the %s", (_name, colors) => {
    expect(luminance(colors.fill)).toBeLessThan(0.1);
    expect(contrast(colors.text, colors.fill)).toBeGreaterThanOrEqual(4.5);
  });
});
