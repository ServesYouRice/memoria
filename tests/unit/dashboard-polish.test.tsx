// @vitest-environment happy-dom

import React from "react";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type * as ReactQueryModule from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type * as SomethingOldCardModule from "@/features/dashboard/components/SomethingOldCard";
import type { CanvasItem } from "@/types/canvas";

const state = vi.hoisted(() => ({
  push: vi.fn(),
  replace: vi.fn(),
  params: new URLSearchParams(),
  workspaces: [
    { id: "w-work", name: "Work", canvasCount: 1 },
    { id: "w-home", name: "Home", canvasCount: 1 },
  ],
  canvases: [
    {
      id: "c1",
      name: "Lisbon weekend",
      workspaceId: "w-home",
      isPublic: true,
      shares: [
        { id: "s1", role: "EDIT", createdAt: "2026-11-01T00:00:00.000Z" },
      ],
      updatedAt: "2026-11-01T00:00:00.000Z",
      thumbnailKey: null,
    },
    {
      id: "c2",
      name: "Project roadmap",
      workspaceId: "w-work",
      isPublic: false,
      shares: [],
      updatedAt: "2026-11-02T00:00:00.000Z",
      thumbnailKey: null,
    },
  ],
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: state.push, replace: state.replace }),
  useSearchParams: () => state.params,
}));
vi.mock("@tanstack/react-query", async (importOriginal) => {
  const actual = await importOriginal<typeof ReactQueryModule>();
  return {
    ...actual,
    useQueryClient: () => ({
      invalidateQueries: vi.fn(),
      setQueriesData: vi.fn(),
    }),
  };
});
vi.mock("@/lib/hooks/use-templates", () => ({
  useTemplates: () => ({ data: undefined, isLoading: false }),
  useCreateFromTemplate: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));
vi.mock("@/lib/hooks/use-canvases", () => ({
  canvasKeys: { all: ["canvases"] },
  useDuplicateCanvas: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useUpdateCanvas: () => ({ mutateAsync: vi.fn() }),
  useCanvases: () => ({
    data: {
      pages: [
        {
          canvases: state.canvases,
          pagination: { total: state.canvases.length },
        },
      ],
    },
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
  useWorkspaces: () => ({
    data: { workspaces: state.workspaces },
    isLoading: false,
    error: null,
  }),
  useAssignCanvasToWorkspace: () => ({ mutateAsync: vi.fn() }),
}));
vi.mock("@/lib/theme-context", () => ({
  useThemeMode: () => ({ mode: "light", toggleTheme: vi.fn() }),
}));
vi.mock("@/features/dashboard/components/ActivityFeed", () => ({
  ActivityFeed: ({ headerAction }: { headerAction?: React.ReactNode }) => (
    <div>
      <span>Latest activity</span>
      {headerAction}
    </div>
  ),
}));
vi.mock("@/features/dashboard/components/SomethingOldCard", () => ({
  SomethingOldCard: () => null,
}));

import { DashboardContent } from "@/features/dashboard/components/DashboardContent";
import { CanvasCard } from "@/features/dashboard/components/CanvasCard";
import { ExportDialog } from "@/features/canvas/components/ExportDialog";

beforeEach(() => {
  vi.clearAllMocks();
  window.localStorage.clear();
  window.sessionStorage.clear();
  state.params = new URLSearchParams();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("Dashboard Phase 3 UX polish", () => {
  it("collapses and expands the activity sidebar and remembers the choice", () => {
    render(<DashboardContent />);
    expect(screen.getByTestId("activity-feed-panel")).toBeTruthy();

    fireEvent.click(
      screen.getByRole("button", { name: "Hide activity sidebar" }),
    );
    expect(screen.queryByTestId("activity-feed-panel")).toBeNull();
    expect(
      window.localStorage.getItem("memoria.dashboard.activityCollapsed"),
    ).toBe("true");

    cleanup();
    render(<DashboardContent />);
    expect(screen.queryByTestId("activity-feed-panel")).toBeNull();

    fireEvent.click(
      screen.getByRole("button", { name: "Show activity sidebar" }),
    );
    expect(screen.getByTestId("activity-feed-panel")).toBeTruthy();
    expect(
      window.localStorage.getItem("memoria.dashboard.activityCollapsed"),
    ).toBe("false");
  });

  it("toggles between Grid and Compact list views and persists the preference", () => {
    render(<DashboardContent />);
    expect(screen.queryByTestId("canvas-list-view")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Compact list view" }));
    expect(screen.getByTestId("canvas-list-view")).toBeTruthy();
    expect(window.localStorage.getItem("memoria.dashboard.viewMode")).toBe(
      "list",
    );
    expect(
      screen.getByRole("link", { name: /Lisbon weekend/ }).getAttribute("href"),
    ).toBe("/canvas/c1");

    cleanup();
    render(<DashboardContent />);
    expect(screen.getByTestId("canvas-list-view")).toBeTruthy();
  });

  it("renders workspace filter pills and navigates on selection", () => {
    render(<DashboardContent />);
    const group = screen.getByTestId("workspace-filter-pills");
    expect(group.textContent).toContain("All canvases");
    expect(group.textContent).toContain("Home");
    expect(group.textContent).toContain("Work");

    fireEvent.click(screen.getByRole("button", { name: "Home" }));
    expect(state.push).toHaveBeenCalledWith("/dashboard?workspace=w-home");

    fireEvent.click(screen.getByRole("button", { name: "All canvases" }));
    expect(state.push).toHaveBeenCalledWith("/dashboard");
  });

  it("surfaces subtle Public and Shared metadata chips on dashboard cards", () => {
    render(<DashboardContent />);
    expect(screen.getByText("Public")).toBeTruthy();
    expect(screen.getByText("Shared")).toBeTruthy();
  });
});

describe("CanvasCard metadata and list variant", () => {
  it("renders item count, Public, and Shared chips without extra interactive elements", () => {
    render(
      <CanvasCard
        name="Design sprint"
        href="/canvas/ds-1"
        variant="list"
        itemCount={4}
        isPublic
        isShared
      />,
    );
    expect(screen.getByText("4 items")).toBeTruthy();
    expect(screen.getByText("Public")).toBeTruthy();
    expect(screen.getByText("Shared")).toBeTruthy();
    expect(screen.queryAllByRole("link")).toHaveLength(1);
    expect(screen.queryByRole("button")).toBeNull();
  });
});

describe("SomethingOldCard session snooze", () => {
  it("dismisses the card for the current session", async () => {
    const { SomethingOldCard: RealSomethingOldCard } = await vi.importActual<
      typeof SomethingOldCardModule
    >("@/features/dashboard/components/SomethingOldCard");

    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({
          item: {
            id: "item-old-1",
            title: "Old recipe",
            canvasName: "Kitchen",
            url: "/canvas/c1?item=item-old-1",
            savedAt: "2020-01-01T00:00:00.000Z",
            lastOpenedAt: null,
          },
        }),
      ),
    );

    const wrap = (ui: React.ReactElement) => {
      const client = new QueryClient({
        defaultOptions: { queries: { retry: false } },
      });
      return render(
        <QueryClientProvider client={client}>{ui}</QueryClientProvider>,
      );
    };

    wrap(<RealSomethingOldCard />);
    expect(await screen.findByText("Old recipe")).toBeTruthy();

    fireEvent.click(
      screen.getByRole("button", { name: "Dismiss for this session" }),
    );
    expect(screen.queryByTestId("something-old")).toBeNull();
    expect(window.sessionStorage.getItem("memoria.somethingOld.snoozed")).toBe(
      "1",
    );

    cleanup();
    wrap(<RealSomethingOldCard />);
    await waitFor(() =>
      expect(screen.queryByTestId("something-old")).toBeNull(),
    );
  });
});

describe("ExportDialog dot/grid background toggle", () => {
  const sampleItem = {
    id: "n1",
    canvasId: "ckcanvas00000000000000000",
    type: "NOTE",
    positionX: 10,
    positionY: 20,
    width: 120,
    height: 80,
    zIndex: 0,
    content: { text: "Hello" },
    tags: [],
    version: 1,
  } as unknown as CanvasItem;

  function makeStage() {
    const gridNode = {
      visible: vi.fn(() => true),
      hide: vi.fn(),
      show: vi.fn(),
    };
    const stage = {
      x: vi.fn(() => 0),
      y: vi.fn(() => 0),
      scaleX: vi.fn(() => 1),
      scaleY: vi.fn(() => 1),
      position: vi.fn(),
      scale: vi.fn(),
      find: vi.fn((selector: string) =>
        selector === ".export-exclude" ? [gridNode] : [],
      ),
      toDataURL: vi.fn(() => "data:image/png;base64,AAAA"),
      batchDraw: vi.fn(),
    };
    return { stage, gridNode };
  }

  it("shows the background toggle for PNG and PDF, and hides it for Markdown", () => {
    render(
      <ExportDialog
        open
        onClose={() => undefined}
        canvasId="ckcanvas00000000000000000"
        canvasName="My Canvas"
        items={[sampleItem]}
        stageRef={{ current: null }}
      />,
    );
    expect(screen.getByLabelText(/Include dot\/grid background/)).toBeTruthy();

    fireEvent.click(screen.getByLabelText(/PDF Document/));
    expect(screen.getByLabelText(/Include dot\/grid background/)).toBeTruthy();

    fireEvent.click(screen.getByLabelText(/Markdown/));
    expect(screen.queryByLabelText(/Include dot\/grid background/)).toBeNull();
  });

  it("keeps the dot/grid overlay visible when Include dot/grid background is enabled", async () => {
    const { stage, gridNode } = makeStage();
    const onClose = vi.fn();

    render(
      <ExportDialog
        open
        onClose={onClose}
        canvasId="ckcanvas00000000000000000"
        canvasName="My Canvas"
        items={[sampleItem]}
        stageRef={{ current: stage }}
      />,
    );

    fireEvent.click(screen.getByLabelText(/Include dot\/grid background/));
    fireEvent.click(screen.getByRole("button", { name: "Export" }));

    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(stage.find).toHaveBeenCalledWith(".export-exclude-none");
    expect(gridNode.hide).not.toHaveBeenCalled();
    expect(stage.toDataURL).toHaveBeenCalledTimes(1);
  });

  it("hides the dot/grid overlay by default during PNG export", async () => {
    const { stage, gridNode } = makeStage();
    const onClose = vi.fn();

    render(
      <ExportDialog
        open
        onClose={onClose}
        canvasId="ckcanvas00000000000000000"
        canvasName="My Canvas"
        items={[sampleItem]}
        stageRef={{ current: stage }}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Export" }));

    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(stage.find).toHaveBeenCalledWith(".export-exclude");
    expect(gridNode.hide).toHaveBeenCalledTimes(1);
    expect(gridNode.show).toHaveBeenCalledTimes(1);
  });
});
