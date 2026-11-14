// @vitest-environment happy-dom
/**
 * IMP-137: each dashboard card has a "..." menu with Rename, Duplicate,
 * Move to workspace and Delete. Its clicks never open the canvas.
 */

import React from "react";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  push: vi.fn(),
  update: vi.fn(async (input: unknown) => input),
  assign: vi.fn(async (input: unknown) => input),
  duplicate: vi.fn(async () => ({ id: "copy", name: "Copy" })),
  apiFetch: vi.fn(async () => new Response(null, { status: 204 })),
  workspaces: [
    { id: "w2", name: "Work" },
    { id: "w1", name: "Home" },
  ] as Array<{ id: string; name: string }>,
  toast: { success: vi.fn(), warning: vi.fn(), error: vi.fn() },
}));

const CANVASES = [
  { id: "c1", name: "Lisbon weekend", workspaceId: null },
  { id: "c2", name: "garden plans", workspaceId: "w2" },
].map((canvas) => ({ ...canvas, updatedAt: "2026-11-01T00:00:00.000Z" }));

vi.mock("sonner", () => ({ toast: state.toast }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: state.push }),
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("@/features/dashboard/components/SomethingOldCard", () => ({
  SomethingOldCard: () => null,
}));
vi.mock("@tanstack/react-query", () => ({
  useQueryClient: () => ({
    invalidateQueries: vi.fn(async () => undefined),
    setQueriesData: vi.fn(),
  }),
}));
vi.mock("@/lib/hooks/use-templates", () => ({
  useTemplates: () => ({ data: undefined, isLoading: false }),
  useCreateFromTemplate: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));
vi.mock("@/lib/hooks/use-canvases", () => ({
  canvasKeys: { all: ["canvases"] },
  useDuplicateCanvas: () => ({
    mutateAsync: state.duplicate,
    isPending: false,
  }),
  useUpdateCanvas: () => ({ mutateAsync: state.update }),
  useCanvases: () => ({
    data: {
      pages: [{ canvases: CANVASES, pagination: { total: CANVASES.length } }],
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
  useAssignCanvasToWorkspace: () => ({ mutateAsync: state.assign }),
}));
vi.mock("@/lib/api/fetch-client", () => ({ apiFetch: state.apiFetch }));
vi.mock("@/lib/theme-context", () => ({
  useThemeMode: () => ({ mode: "light", toggleTheme: vi.fn() }),
}));
vi.mock("@/features/dashboard/components/ActivityFeed", () => ({
  ActivityFeed: () => null,
}));

import { DashboardContent } from "@/features/dashboard/components/DashboardContent";

function openMenu(name: string) {
  render(<DashboardContent />);
  fireEvent.click(screen.getByRole("button", { name: `Options for ${name}` }));
  return screen.getByRole("menu");
}

beforeEach(() => {
  vi.clearAllMocks();
  state.workspaces = [
    { id: "w2", name: "Work" },
    { id: "w1", name: "Home" },
  ];
});
afterEach(cleanup);

describe("canvas card menu (IMP-137)", () => {
  it("lists Rename, Duplicate, Move to workspace and Move to Trash in order", () => {
    const menu = openMenu("Lisbon weekend");
    expect(
      within(menu)
        .getAllByRole("menuitem")
        .map((item) => item.textContent),
    ).toEqual(["Rename", "Duplicate", "Move to workspace", "Move to Trash"]);
  });

  it("does not follow the card link", () => {
    render(<DashboardContent />);
    const button = screen.getByRole("button", {
      name: "Options for Lisbon weekend",
    });
    expect(button.getAttribute("aria-haspopup")).toBe("menu");
    expect(button.closest("a")).toBeNull();
    // fireEvent returns false when the click's default was prevented.
    expect(fireEvent.click(button)).toBe(false);
    const rename = screen.getByRole("menuitem", { name: "Rename" });
    expect(fireEvent.click(rename)).toBe(false);
    expect(state.push).not.toHaveBeenCalled();
  });

  it("renames the canvas", async () => {
    openMenu("Lisbon weekend");
    fireEvent.click(screen.getByRole("menuitem", { name: "Rename" }));
    expect(screen.getByRole("dialog", { name: "Rename canvas" })).toBeTruthy();
    const field = screen.getByLabelText(/^Name/) as HTMLInputElement;
    expect(field.value).toBe("Lisbon weekend");

    fireEvent.change(field, { target: { value: "   " } });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Save" }));
    });
    expect(screen.getByText("Enter a name")).toBeTruthy();
    expect(state.update).not.toHaveBeenCalled();

    fireEvent.change(field, { target: { value: "Lisbon trip" } });
    await act(async () => {
      fireEvent.submit(field.closest("form")!);
    });
    expect(state.update).toHaveBeenCalledWith({
      canvasId: "c1",
      data: { name: "Lisbon trip" },
    });
    expect(state.toast.success).toHaveBeenCalledWith("Renamed");
    await waitFor(() =>
      expect(
        screen.queryByRole("dialog", { name: "Rename canvas" }),
      ).toBeNull(),
    );
  });

  it("moves the canvas into a workspace, by name, with a tick on the current one", async () => {
    openMenu("Lisbon weekend");
    fireEvent.click(
      screen.getByRole("menuitem", { name: "Move to workspace" }),
    );
    const dialog = screen.getByRole("dialog", { name: "Move to workspace" });
    const rows = within(dialog)
      .getAllByRole("button")
      .filter((row) => row.textContent !== "Cancel");
    expect(rows.map((row) => row.textContent)).toEqual([
      "No workspace",
      "Home",
      "Work",
    ]);
    expect(within(rows[0]).getByLabelText("Current")).toBeTruthy();

    await act(async () => {
      fireEvent.click(within(dialog).getByRole("button", { name: "Work" }));
    });
    expect(state.assign).toHaveBeenCalledWith({
      canvasId: "c1",
      workspaceId: "w2",
    });
    expect(state.toast.success).toHaveBeenCalledWith("Moved to Work");
  });

  it("sends null for No workspace", async () => {
    openMenu("garden plans");
    fireEvent.click(
      screen.getByRole("menuitem", { name: "Move to workspace" }),
    );
    const dialog = screen.getByRole("dialog", { name: "Move to workspace" });
    expect(
      within(
        within(dialog).getByRole("button", { name: /Work/ }),
      ).getByLabelText("Current"),
    ).toBeTruthy();
    await act(async () => {
      fireEvent.click(
        within(dialog).getByRole("button", { name: "No workspace" }),
      );
    });
    expect(state.assign).toHaveBeenCalledWith({
      canvasId: "c2",
      workspaceId: null,
    });
    expect(state.toast.success).toHaveBeenCalledWith("Removed from workspace");
  });

  it("shows the server's reason when a move fails", async () => {
    state.assign.mockRejectedValueOnce(new Error("Workspace not found."));
    openMenu("Lisbon weekend");
    fireEvent.click(
      screen.getByRole("menuitem", { name: "Move to workspace" }),
    );
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Home" }));
    });
    expect(state.toast.error).toHaveBeenCalledWith("Workspace not found.");
  });

  it("points to the workspaces page when there are none", () => {
    state.workspaces = [];
    openMenu("Lisbon weekend");
    fireEvent.click(
      screen.getByRole("menuitem", { name: "Move to workspace" }),
    );
    expect(screen.getByText(/You have no workspaces yet\./)).toBeTruthy();
    expect(
      screen
        .getByRole("link", { name: "Create a workspace" })
        .getAttribute("href"),
    ).toBe("/workspaces");
  });

  it("duplicates the canvas", async () => {
    openMenu("garden plans");
    await act(async () => {
      fireEvent.click(screen.getByRole("menuitem", { name: "Duplicate" }));
    });
    expect(state.duplicate).toHaveBeenCalledWith("c2");
  });

  it("asks to move exactly that canvas to Trash", async () => {
    openMenu("garden plans");
    fireEvent.click(screen.getByRole("menuitem", { name: "Move to Trash" }));
    const dialog = screen.getByRole("dialog", {
      name: "Move 1 canvas to Trash?",
    });
    expect(dialog.textContent).toContain("You can restore it from Trash");
    await act(async () => {
      fireEvent.click(
        within(dialog).getByRole("button", { name: "Move to Trash" }),
      );
    });
    await waitFor(() => expect(state.apiFetch).toHaveBeenCalledTimes(1));
    expect(state.apiFetch).toHaveBeenCalledWith("/api/v1/canvases/c2", {
      method: "DELETE",
    });
  });

  it("keeps the checkbox in selection mode", () => {
    render(<DashboardContent />);
    fireEvent.click(screen.getByRole("button", { name: "Select" }));
    expect(screen.queryByRole("button", { name: /^Options for/ })).toBeNull();
    expect(screen.getAllByRole("checkbox")).toHaveLength(2);
  });
});
