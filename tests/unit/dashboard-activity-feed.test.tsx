// @vitest-environment happy-dom

import React from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type * as ThemeContextModule from "@/lib/theme-context";
import type * as ActivityFeedModule from "@/features/dashboard/components/ActivityFeed";

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
// Templates and duplication (IMP-098) have their own tests.
vi.mock("@/lib/hooks/use-templates", () => ({
  useTemplates: () => ({ data: undefined, isLoading: false }),
  useCreateFromTemplate: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));
vi.mock("@/lib/hooks/use-canvases", () => ({
  canvasKeys: { all: ["canvases"] },
  useDuplicateCanvas: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useUpdateCanvas: () => ({ mutateAsync: vi.fn() }),
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
  useAssignCanvasToWorkspace: () => ({ mutateAsync: vi.fn() }),
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
import { getActivityMessage } from "@/features/dashboard/components/activity-utils";

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

// IMP-138: the real feed, rendered from mocked activity rows.
const feedRows = vi.hoisted(() => ({
  rows: [] as Array<Record<string, unknown>>,
  hasNextPage: false,
}));
vi.mock("@/lib/hooks/use-activities", () => ({
  useActivities: () => ({
    data: { pages: [{ activities: feedRows.rows }] },
    isLoading: false,
    error: null,
    hasNextPage: feedRows.hasNextPage,
    fetchNextPage: vi.fn(),
    isFetchingNextPage: false,
  }),
}));

const minutesAgo = (minutes: number) =>
  new Date(Date.now() - minutes * 60_000).toISOString();

function row(
  id: string,
  type: string,
  canvasId: string | null,
  canvasName: string | null,
  minutes: number,
) {
  return {
    id,
    userId: "u1",
    type,
    canvasId,
    canvasName,
    itemId: null,
    metadata: null,
    createdAt: minutesAgo(minutes),
  };
}

async function renderFeed() {
  const { ActivityFeed } = await vi.importActual<typeof ActivityFeedModule>(
    "@/features/dashboard/components/ActivityFeed",
  );
  render(<ActivityFeed limit={15} />);
}

const lines = () =>
  screen.queryAllByRole("listitem").map((item) => item.textContent ?? "");

describe("activity feed lines (IMP-138)", () => {
  it("joins repeated item rows for one canvas into one line", async () => {
    feedRows.rows = Array.from({ length: 7 }, (_, i) =>
      row(`a${i}`, "ITEM_CREATED", "c1", "Lisbon weekend", i * 5),
    );
    await renderFeed();
    expect(screen.getByText("Latest activity")).toBeTruthy();
    const line = screen.getByText("Added 7 items to “Lisbon weekend”");
    expect(line.closest("a")?.getAttribute("href")).toBe("/canvas/c1");
    expect(lines()).toHaveLength(1);
  });

  it("keeps rows for different canvases, kinds or hours apart", async () => {
    feedRows.rows = [
      row("a1", "ITEM_CREATED", "c1", "Lisbon weekend", 0),
      row("a2", "ITEM_CREATED", "c2", "Garden", 1),
      row("a3", "ITEM_CREATED", "c2", "Garden", 2),
      row("a4", "ITEM_UPDATED", "c2", "Garden", 3),
      row("a5", "ITEM_UPDATED", "c2", "Garden", 90),
    ];
    await renderFeed();
    expect(lines()).toEqual([
      expect.stringContaining("Added an item to “Lisbon weekend”"),
      expect.stringContaining("Added 2 items to “Garden”"),
      expect.stringContaining("Updated an item in “Garden”"),
      expect.stringContaining("Updated an item in “Garden”"),
    ]);
  });

  it("shows five lines until Show all activity is pressed", async () => {
    feedRows.hasNextPage = true;
    try {
      feedRows.rows = Array.from({ length: 8 }, (_, i) =>
        row(`a${i}`, "CANVAS_CREATED", `c${i}`, `Canvas ${i}`, i),
      );
      await renderFeed();
      // Five lines plus the row holding the button.
      expect(lines()).toHaveLength(6);
      expect(screen.queryByText("Created canvas “Canvas 5”")).toBeNull();
      expect(
        screen.queryByRole("button", { name: "Load more activity" }),
      ).toBeNull();
      fireEvent.click(
        screen.getByRole("button", { name: "Show all activity" }),
      );
      expect(
        screen.queryByRole("button", { name: "Show all activity" }),
      ).toBeNull();
      expect(screen.getByText("Created canvas “Canvas 7”")).toBeTruthy();
      expect(
        screen.getByRole("button", { name: "Load more activity" }),
      ).toBeTruthy();
    } finally {
      feedRows.hasNextPage = false;
    }
  });

  it("names a canvas that no longer exists as a deleted canvas", async () => {
    feedRows.rows = [
      row("a1", "ITEM_DELETED", "gone", null, 0),
      row("a2", "ITEM_DELETED", "gone", null, 1),
      row("a3", "ITEM_CREATED", "gone2", null, 2),
    ];
    await renderFeed();
    expect(
      screen.getByText("Deleted 2 items from a deleted canvas"),
    ).toBeTruthy();
    expect(screen.getByText("Added an item to a deleted canvas")).toBeTruthy();
  });

  it("keeps the empty text", async () => {
    feedRows.rows = [];
    await renderFeed();
    expect(screen.getByText("No recent activity")).toBeTruthy();
  });
});

describe("single activity messages", () => {
  it("keep their one-row wording", () => {
    expect(
      getActivityMessage({
        type: "ITEM_CREATED",
        canvasName: "Lisbon weekend",
      }),
    ).toBe("added an item to “Lisbon weekend”");
    expect(
      getActivityMessage({ type: "CANVAS_SHARED", canvasName: null }),
    ).toBe("shared canvas a canvas");
  });
});
