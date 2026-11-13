import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  LAUNCH_CAPABILITIES,
  isLaunchCapabilityEnabled,
} from "@/lib/product-surfaces";
import { brand, createAppTheme } from "@/lib/theme";

function source(path: string): string {
  return readFileSync(resolve(process.cwd(), path), "utf8");
}

function occurrences(value: string, pattern: RegExp): number {
  return Array.from(value.matchAll(pattern)).length;
}

describe("launch capability registry", () => {
  it("declares every deliberately gated launch surface in one client-safe registry", () => {
    // IMP-098 built the template and duplication routes, then switched them on.
    expect(LAUNCH_CAPABILITIES).toEqual({
      templates: true,
      canvasDuplication: true,
      polls: true,
    });
    expect(isLaunchCapabilityEnabled("templates")).toBe(true);
    expect(isLaunchCapabilityEnabled("canvasDuplication")).toBe(true);
    // IMP-104: votes are counted on the server, so polls are on.
    expect(isLaunchCapabilityEnabled("polls")).toBe(true);
  });

  it("offers duplication and templates from the dashboard through their hooks", () => {
    const dashboard = source(
      "src/features/dashboard/components/DashboardContent.tsx",
    );
    expect(dashboard).toContain("useDuplicateCanvas");
    expect(dashboard).toContain("<TemplatePicker");
    // Routes stay behind the hooks, never called from the component.
    expect(dashboard).not.toContain("/duplicate");
  });
});

describe("canvas route composition", () => {
  it("renders exactly one accessible organizer on editable and public routes", () => {
    const editable = source("src/features/canvas/components/CanvasBoard.tsx");
    const shared = source("src/app/share/[token]/page.tsx");
    expect(occurrences(editable, /<CanvasAccessiblePanel\b/g)).toBe(1);
    expect(occurrences(shared, /<CanvasAccessiblePanel\b/g)).toBe(1);
  });

  it("ships one skip target, primary navigation landmark, and current-page state", () => {
    const shell = source("src/components/layout/AppShell.tsx");
    expect(shell).toContain("Skip to main content");
    expect(shell).toContain('href="#main-content"');
    expect(shell).toContain('aria-label="Primary navigation"');
    expect(shell).toContain('aria-current={isActive(item.href) ? "page"');
  });

  it("uses programmatic, mobile-safe share confirmations", () => {
    const shareDialog = source(
      "src/features/canvas/components/ShareDialog.tsx",
    );
    expect(shareDialog).toContain("confirmDialog");
    expect(shareDialog).toContain("fullScreen={fullScreen}");
    expect(shareDialog).not.toContain("window.confirm");
  });
});

describe("selected app theme owns non-MUI CSS", () => {
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

  it("uses the solid brand blue as the light interactive primary", () => {
    expect(createAppTheme().colorSchemes.light?.palette.primary.main).toBe(
      brand.primary.main,
    );
  });

  it.each(["light", "dark"] as const)(
    "keeps links, labels and filled controls at 4.5:1 in %s mode",
    (mode) => {
      const palette = createAppTheme().colorSchemes[mode]!.palette;
      const { primary, secondary, error, text, background } = palette;
      for (const surface of [background.paper, background.default]) {
        expect(contrast(primary.main, surface)).toBeGreaterThanOrEqual(4.5);
        expect(contrast(text.primary, surface)).toBeGreaterThanOrEqual(4.5);
        expect(contrast(text.secondary, surface)).toBeGreaterThanOrEqual(4.5);
        expect(contrast(error.main, surface)).toBeGreaterThanOrEqual(4.5);
      }
      for (const color of [primary, secondary]) {
        expect(contrast(color.contrastText, color.main)).toBeGreaterThanOrEqual(
          4.5,
        );
        expect(contrast(color.contrastText, color.dark)).toBeGreaterThanOrEqual(
          4.5,
        );
      }
    },
  );

  it.each(["src/app/tiptap.css", "src/components/command-palette.css"])(
    "follows the selected theme in %s",
    (path) => {
      // Colours come from the MUI theme variables, which switch with the
      // app's data-theme selection (IMP-080), never from the OS preference.
      const css = source(path);
      expect(css).toContain("var(--mui-palette-");
      expect(css).not.toMatch(/#[0-9a-f]{3,8}\b|rgba?\(/i);
      expect(css).not.toContain("prefers-color-scheme");
    },
  );
});

describe("keyboard submission contracts", () => {
  it.each([
    "src/features/dashboard/components/DashboardContent.tsx",
    "src/app/workspaces/WorkspacesPageClient.tsx",
    "src/features/canvas/components/AIDialog.tsx",
    "src/features/canvas/components/WhisperMode.tsx",
  ])("guards async Enter submissions in %s", (path) => {
    const component = source(path);
    expect(component).toContain("useRef");
    expect(component).toContain("preventDefault()");
    expect(component).toMatch(
      /InFlightRef|SubmittingRef|CreatingRef|EditingRef/,
    );
  });
});

describe("public launch copy", () => {
  it("states enforced limits and contains no unearned launch claims", () => {
    const copy = [
      source("src/app/page.tsx"),
      source("src/features/auth/components/RegisterForm.tsx"),
    ].join("\n");
    expect(copy).toContain("LAUNCH_LIMITS.canvasesPerUser");
    expect(copy).toContain("LAUNCH_LIMITS.itemsPerCanvas");
    expect(copy).not.toMatch(
      /unlimited|free forever|enterprise-grade|join thousands|blazing fast|lightning fast|export anywhere/i,
    );
    expect(copy).toMatch(/PNG, PDF, Markdown, or JSON/);
  });
});
