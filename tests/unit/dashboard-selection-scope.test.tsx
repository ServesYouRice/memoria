// @vitest-environment happy-dom
/**
 * TASK-056 — the canvas selection does not survive a workspace filter change,
 * so a bulk delete only ever deletes canvases that are on screen.
 */

import React from "react";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ params: new URLSearchParams() }));

const CANVASES: Record<string, Array<{ id: string; name: string }>> = {
  A: [
    { id: "a-1", name: "Alpha one" },
    { id: "a-2", name: "Alpha two" },
  ],
  B: [{ id: "b-1", name: "Beta one" }],
};

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
  useSearchParams: () => state.params,
}));
vi.mock("@tanstack/react-query", () => ({
  useQueryClient: () => ({
    invalidateQueries: vi.fn(async () => undefined),
    setQueriesData: vi.fn(),
  }),
}));
vi.mock("@/features/dashboard/components/SomethingOldCard", () => ({
  SomethingOldCard: () => null,
}));
// Templates and duplication (IMP-098) have their own tests.
vi.mock("@/lib/hooks/use-templates", () => ({
  useTemplates: () => ({ data: undefined, isLoading: false }),
  useCreateFromTemplate: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));
vi.mock("@/lib/hooks/use-canvases", () => ({
  canvasKeys: { all: ["canvases"] },
  useDuplicateCanvas: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useCanvases: (workspaceId?: string) => {
    const canvases = (CANVASES[workspaceId ?? ""] ?? []).map((canvas) => ({
      ...canvas,
      updatedAt: "2026-11-01T00:00:00.000Z",
    }));
    return {
      data: {
        pages: [{ canvases, pagination: { total: canvases.length } }],
      },
      isLoading: false,
      error: null,
      hasNextPage: false,
      fetchNextPage: vi.fn(),
      isFetchingNextPage: false,
    };
  },
  useCreateCanvas: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));
vi.mock("@/lib/hooks/use-workspaces", () => ({
  useWorkspace: () => ({ data: undefined }),
}));
vi.mock("@/lib/theme-context", () => ({
  useThemeMode: () => ({ mode: "light", toggleTheme: vi.fn() }),
}));
vi.mock("@/features/dashboard/components/ActivityFeed", () => ({
  ActivityFeed: () => null,
}));
vi.mock("@/components/GlobalSearchDialog", () => ({
  GlobalSearchDialog: () => null,
}));
vi.mock("@/components/CommandPalette", () => ({
  CommandPalette: () => null,
}));

import { DashboardContent } from "@/features/dashboard/components/DashboardContent";

const fetchMock = vi.fn(
  async () => new Response(JSON.stringify({ success: true }), { status: 200 }),
);

beforeEach(() => {
  fetchMock.mockClear();
  vi.stubGlobal("fetch", fetchMock);
  state.params = new URLSearchParams("workspace=A");
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("dashboard selection across workspace filters", () => {
  it("clears the selection when the workspace changes and deletes only visible canvases", async () => {
    const view = render(<DashboardContent />);
    fireEvent.click(screen.getByRole("button", { name: "Select" }));
    fireEvent.click(screen.getByRole("button", { name: "Select all" }));
    expect(screen.getByText("2 selected")).toBeTruthy();

    state.params = new URLSearchParams("workspace=B");
    view.rerender(<DashboardContent />);
    await waitFor(() => expect(screen.getByText("Beta one")).toBeTruthy());
    expect(screen.getByText("0 selected")).toBeTruthy();

    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    expect(
      await screen.findByText(/delete 1 canvas\? This action cannot be undone/),
    ).toBeTruthy();
    const dialogButtons = screen.getAllByRole("button", { name: "Delete" });
    fireEvent.click(dialogButtons[dialogButtons.length - 1]);

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const urls = fetchMock.mock.calls.map((call) =>
      String((call as unknown[])[0]),
    );
    expect(urls).toEqual(["/api/v1/canvases/b-1"]);
  });
});
