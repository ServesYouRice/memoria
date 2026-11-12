// @vitest-environment happy-dom

import React from "react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type * as ThemeContextModule from "@/lib/theme-context";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));
// "Something old" (IMP-097) has its own tests.
vi.mock("@/features/dashboard/components/SomethingOldCard", () => ({
  SomethingOldCard: () => null,
}));
vi.mock("@tanstack/react-query", () => ({
  useQueryClient: () => ({ invalidateQueries: vi.fn() }),
}));
vi.mock("@/lib/hooks/use-canvases", () => ({
  canvasKeys: { all: ["canvases"] },
  useCanvases: () => ({
    data: { pages: [{ canvases: [], pagination: { total: 0 } }] },
    isLoading: false,
    error: null,
    hasNextPage: false,
    fetchNextPage: vi.fn(),
    isFetchingNextPage: false,
  }),
  useCreateCanvas: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));
vi.mock("@/lib/hooks/use-workspaces", () => ({
  useWorkspace: () => ({ data: undefined }),
}));
vi.mock("@/lib/theme-context", async (importOriginal) => ({
  ...(await importOriginal<typeof ThemeContextModule>()),
  useThemeMode: () => ({ mode: "light", toggleTheme: vi.fn() }),
}));
vi.mock("@/features/dashboard/components/ActivityFeed", () => ({
  ActivityFeed: () => <div>Recent activity</div>,
}));
vi.mock("@/components/GlobalSearchDialog", () => ({
  GlobalSearchDialog: () => null,
}));
vi.mock("@/components/CommandPalette", () => ({
  CommandPalette: () => null,
}));
vi.mock("@/components/layout/PageHeader", () => ({
  PageHeader: () => null,
}));

import { DashboardContent } from "@/features/dashboard/components/DashboardContent";
import { AppThemeProvider } from "@/lib/theme-context";

function cssText(): string {
  return Array.from(document.querySelectorAll("style"))
    .map((style) => style.textContent ?? "")
    .join("\n");
}

afterEach(cleanup);

describe("dashboard activity feed on small screens", () => {
  it("is never hidden by a breakpoint rule", () => {
    render(<DashboardContent />);
    const panel = screen.getByTestId("activity-feed-panel");

    expect(screen.getByText("Recent activity")).toBeTruthy();

    const css = Array.from(document.querySelectorAll("style"))
      .map((style) => style.textContent ?? "")
      .join("\n");
    const classes = panel.className.split(/\s+/).filter(Boolean);
    const panelRules = css
      .split("}")
      .filter((rule) => classes.some((cls) => rule.includes(`.${cls}`)));

    expect(panelRules.length).toBeGreaterThan(0);
    expect(panelRules.join("}")).not.toMatch(/display:\s*none/);
  });
});

describe("dashboard panels in dark mode", () => {
  it("take their colours from the active scheme, not the first render", () => {
    document.documentElement.setAttribute("data-theme", "dark");
    try {
      render(
        <AppThemeProvider>
          <DashboardContent />
        </AppThemeProvider>,
      );
      const panel = screen.getByTestId("activity-feed-panel");
      const css = cssText();
      const panelRules = css
        .split("}")
        .filter((rule) =>
          panel.className
            .split(/\s+/)
            .some((cls) => cls.startsWith("css-") && rule.includes(`.${cls}`)),
        )
        .join("}");

      // The class is identical in both modes: its background is a CSS
      // variable, so server HTML painted before the stored mode loads is
      // still correct once `data-theme` is set.
      expect(panelRules).toMatch(
        /background-color:\s*var\(--mui-palette-background-paper\)/,
      );
      expect(panelRules).not.toMatch(/background-color:\s*(#|rgb)/);
      expect(css).toMatch(
        /\[data-theme="dark"\][^{]*\{[^}]*--mui-palette-background-paper:\s*#111a2e/,
      );
    } finally {
      document.documentElement.removeAttribute("data-theme");
    }
  });
});
