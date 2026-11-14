import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { appColorTokens, brand, createAppTheme } from "@/lib/theme";

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

function containedPrimaryStyle(): Style {
  const theme = createAppTheme();
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
  it("uses a solid fill, never a gradient, when enabled", () => {
    const style = containedPrimaryStyle();
    expect(JSON.stringify(style)).not.toContain("gradient");
    expect(style.background).toBeUndefined();
  });

  it.each(["light", "dark"] as const)(
    "uses a flat, readable disabled style without the gradient (%s)",
    (mode) => {
      const disabled = containedPrimaryStyle()["&.Mui-disabled"] as Style;
      expect(disabled).toBeDefined();
      expect(disabled.background).toBe("var(--app-disabled-button-background)");
      expect(disabled.color).toBe("var(--app-disabled-button-text)");
      const background = appColorTokens[mode].disabledButtonBackground;
      expect(background).not.toContain("gradient");
      expect(background).toMatch(/^#[0-9a-f]{6}$/i);
      expect(
        contrast(appColorTokens[mode].disabledButtonText, background),
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

/** `fg` at `opacity` over the solid `bg`, as a hex colour. */
function over(fg: string, opacity: number, bg: string): string {
  const channels = (hex: string) =>
    [0, 2, 4].map((i) => parseInt(hex.replace("#", "").slice(i, i + 2), 16));
  const [f, b] = [channels(fg), channels(bg)];
  return `#${f
    .map((c, i) =>
      Math.round(c * opacity + b[i] * (1 - opacity))
        .toString(16)
        .padStart(2, "0"),
    )
    .join("")}`;
}

describe("canvas header Live label (IMP-125)", () => {
  // The header is the glass app bar (80% white or navy) over the page.
  const header = {
    light: over("#ffffff", 0.8, "#f0f2f5"),
    dark: over("#0f172a", 0.8, "#0b1120"),
  };

  it.each(["light", "dark"] as const)(
    "reads at 4.5:1 or more on its green tint (%s)",
    (mode) => {
      const tint = over(brand.success.main, 0.12, header[mode]);
      expect(
        contrast(appColorTokens[mode].liveStatusText, tint),
      ).toBeGreaterThanOrEqual(4.5);
    },
  );
});
