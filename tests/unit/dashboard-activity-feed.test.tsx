// @vitest-environment happy-dom

import React from "react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
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
vi.mock("@/lib/theme-context", () => ({
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
