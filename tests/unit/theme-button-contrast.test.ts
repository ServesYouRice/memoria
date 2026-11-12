import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { createAppTheme, gradients } from "@/lib/theme";

function luminance(hex: string): number {
  const value = hex.replace("#", "");
  const full =
    value.length === 3
      ? value
          .split("")
          .map((c) => c + c)
          .join("")
      : value;
  const [r, g, b] = [0, 2, 4].map((i) => {
    const channel = parseInt(full.slice(i, i + 2), 16) / 255;
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

type Style = Record<string, unknown>;

function containedPrimaryStyle(mode: "light" | "dark"): Style {
  const theme = createAppTheme(mode);
  const variants = theme.components?.MuiButton?.variants ?? [];
  const match = variants.find(
    (v) =>
      typeof v.props === "object" &&
      (v.props as Style).variant === "contained" &&
      (v.props as Style).color === "primary",
  );
  expect(match).toBeDefined();
  return match!.style as Style;
}

describe("contained primary button", () => {
  it.each(["light", "dark"] as const)(
    "keeps the gradient when enabled (%s)",
    (mode) => {
      expect(containedPrimaryStyle(mode).background).toBe(gradients.brand);
    },
  );

  it.each(["light", "dark"] as const)(
    "uses a flat, readable disabled style without the gradient (%s)",
    (mode) => {
      const disabled = containedPrimaryStyle(mode)["&.Mui-disabled"] as Style;
      expect(disabled).toBeDefined();
      const background = String(disabled.background);
      expect(background).not.toContain("gradient");
      expect(background).toMatch(/^#[0-9a-f]{6}$/i);
      expect(
        contrast(String(disabled.color), background),
      ).toBeGreaterThanOrEqual(3);
    },
  );
});

describe("home page bottom sign-up button", () => {
  it("keeps its label above 4.5:1 at rest and on hover/focus", () => {
    const source = readFileSync(
      path.join(process.cwd(), "src/app/page.tsx"),
      "utf8",
    );
    const label = source.match(
      /const CTA_LABEL_COLOR = "(#[0-9a-f]{6})"/i,
    )?.[1];
    expect(label).toBeDefined();
    const ctaBlock = source.slice(source.lastIndexOf("Create account") - 600);
    expect(ctaBlock).toContain('background: "#fff"');
    expect(ctaBlock).toContain('background: "#f1f5f9"');
    expect(contrast(label!, "#ffffff")).toBeGreaterThanOrEqual(4.5);
    expect(contrast(label!, "#f1f5f9")).toBeGreaterThanOrEqual(4.5);
  });
});
