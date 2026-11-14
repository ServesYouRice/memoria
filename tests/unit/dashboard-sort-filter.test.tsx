// @vitest-environment happy-dom
/**
 * IMP-136: the dashboard has one "New canvas" button, an "Import" button,
 * and a name filter and sort above the cards that ask the server.
 */

import React from "react";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type ListOptions = { sort?: string; q?: string };

const list = vi.hoisted(() => ({
  calls: [] as Array<{ workspaceId?: string; options?: ListOptions }>,
  names: ["garden plans", "Lisbon weekend"],
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("@/features/dashboard/components/SomethingOldCard", () => ({
  SomethingOldCard: () => null,
}));
vi.mock("@tanstack/react-query", () => ({
  useQueryClient: () => ({ invalidateQueries: vi.fn() }),
}));
vi.mock("@/lib/hooks/use-templates", () => ({
  useTemplates: () => ({ data: undefined, isLoading: false }),
  useCreateFromTemplate: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));
vi.mock("@/lib/hooks/use-canvases", () => ({
  canvasKeys: { all: ["canvases"] },
  useDuplicateCanvas: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useUpdateCanvas: () => ({ mutateAsync: vi.fn() }),
  useCanvases: (workspaceId?: string, options?: ListOptions) => {
    list.calls.push({ workspaceId, options });
    const q = options?.q?.toLowerCase();
    const canvases = list.names
      .filter((name) => !q || name.toLowerCase().includes(q))
      .map((name, index) => ({
        id: `c${index}`,
        name,
        updatedAt: new Date().toISOString(),
        thumbnailKey: null,
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
  useAssignCanvasToWorkspace: () => ({ mutateAsync: vi.fn() }),
}));
vi.mock("@/lib/theme-context", () => ({
  useThemeMode: () => ({ mode: "light", toggleTheme: vi.fn() }),
}));
vi.mock("@/features/dashboard/components/ActivityFeed", () => ({
  ActivityFeed: () => null,
}));

import { DashboardContent } from "@/features/dashboard/components/DashboardContent";

const lastOptions = () =>
  list.calls.filter((call) => call.options).at(-1)?.options;

beforeEach(() => {
  list.calls = [];
  list.names = ["garden plans", "Lisbon weekend"];
  window.localStorage.clear();
  vi.useFakeTimers();
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("dashboard sort and filter (IMP-136)", () => {
  it("has one way to start a canvas, plus Select and Import", () => {
    render(<DashboardContent />);
    const buttons = screen
      .getAllByRole("button")
      .map((button) => button.textContent);
    expect(buttons).toEqual(
      expect.arrayContaining(["Select", "Import", "New canvas"]),
    );
    expect(buttons).not.toContain("Open file");
    expect(screen.queryByText("Blank canvas")).toBeNull();
  });

  it("sends the typed name to the server after a pause", () => {
    render(<DashboardContent />);
    fireEvent.change(screen.getByLabelText("Filter by name"), {
      target: { value: "gar" },
    });
    expect(lastOptions()?.q).toBeUndefined();
    act(() => {
      vi.advanceTimersByTime(250);
    });
    expect(lastOptions()).toMatchObject({ q: "gar" });
    expect(screen.getByText("garden plans")).toBeTruthy();
    expect(screen.queryByText("Lisbon weekend")).toBeNull();
  });

  it("sorts by name on the server and remembers the choice", () => {
    render(<DashboardContent />);
    fireEvent.change(screen.getByLabelText("Sort by"), {
      target: { value: "name" },
    });
    expect(lastOptions()).toMatchObject({ sort: "name" });
    expect(window.localStorage.getItem("memoria.dashboard.sort")).toBe("name");
    cleanup();
    list.calls = [];
    render(<DashboardContent />);
    expect(lastOptions()).toMatchObject({ sort: "name" });
    expect((screen.getByLabelText("Sort by") as HTMLSelectElement).value).toBe(
      "name",
    );
  });

  it("offers the three sort orders", () => {
    render(<DashboardContent />);
    const select = screen.getByLabelText("Sort by") as HTMLSelectElement;
    expect(Array.from(select.options).map((option) => option.text)).toEqual([
      "Recently updated",
      "Name (A to Z)",
      "Newest first",
    ]);
  });

  it("says when nothing matches and clears the filter", () => {
    render(<DashboardContent />);
    fireEvent.change(screen.getByLabelText("Filter by name"), {
      target: { value: "zzz" },
    });
    act(() => {
      vi.advanceTimersByTime(250);
    });
    expect(screen.getByText('No canvases match "zzz"')).toBeTruthy();
    expect(screen.queryByText("Create your first canvas")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Clear filter" }));
    expect(lastOptions()?.q).toBeUndefined();
    expect(screen.getByText("Lisbon weekend")).toBeTruthy();
    expect(
      (screen.getByLabelText("Filter by name") as HTMLInputElement).value,
    ).toBe("");
  });

  it("hides the row when there are no canvases and no filter", () => {
    list.names = [];
    render(<DashboardContent />);
    expect(screen.queryByLabelText("Filter by name")).toBeNull();
    expect(screen.getByText("Create your first canvas")).toBeTruthy();
  });
});
