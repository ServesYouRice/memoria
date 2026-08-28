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
    expect(LAUNCH_CAPABILITIES).toEqual({
      templates: false,
      canvasDuplication: false,
      polls: false,
    });
    expect(isLaunchCapabilityEnabled("templates")).toBe(false);
    expect(isLaunchCapabilityEnabled("canvasDuplication")).toBe(false);
    expect(isLaunchCapabilityEnabled("polls")).toBe(false);
  });

  it("does not expose whole-canvas duplication from the dashboard", () => {
    const dashboard = source(
      "src/features/dashboard/components/DashboardContent.tsx",
    );
    expect(dashboard).not.toMatch(
      /useDuplicateCanvas|DuplicateIcon|>Duplicate</,
    );
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
  it("uses a contrast-safe light interactive primary", () => {
    expect(createAppTheme("light").palette.primary.main).toBe(
      brand.primary.dark,
    );
  });

  it.each(["src/app/tiptap.css", "src/components/command-palette.css"])(
    "uses data-theme selectors in %s",
    (path) => {
      const css = source(path);
      expect(css).toMatch(/data-theme=["']dark["']/);
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
