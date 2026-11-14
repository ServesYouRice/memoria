// @vitest-environment happy-dom
/**
 * TASK-243 — bulk delete keeps few DELETEs in flight, stops on a 429, shows
 * the server's reason and keeps failed or unsent canvases selected.
 * IMP-133 — deleting moves canvases to Trash, and the toast offers Undo.
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

const state = vi.hoisted(() => ({
  setQueriesData: vi.fn(),
  invalidateQueries: vi.fn(async () => undefined),
  toast: {
    success: vi.fn(),
    warning: vi.fn(),
    error: vi.fn(),
  },
}));

const CANVASES = Array.from({ length: 10 }, (_, i) => ({
  id: `c${i}`,
  name: `Canvas ${i}`,
  updatedAt: "2026-11-01T00:00:00.000Z",
}));

vi.mock("sonner", () => ({ toast: state.toast }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));
// "Something old" (IMP-097) has its own tests.
vi.mock("@/features/dashboard/components/SomethingOldCard", () => ({
  SomethingOldCard: () => null,
}));
vi.mock("@tanstack/react-query", () => ({
  useQueryClient: () => ({
    invalidateQueries: state.invalidateQueries,
    setQueriesData: state.setQueriesData,
  }),
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
  useAssignCanvasToWorkspace: () => ({ mutateAsync: vi.fn() }),
}));
vi.mock("@/lib/theme-context", () => ({
  useThemeMode: () => ({ mode: "light", toggleTheme: vi.fn() }),
}));
vi.mock("@/features/dashboard/components/ActivityFeed", () => ({
  ActivityFeed: () => null,
}));

import { DashboardContent } from "@/features/dashboard/components/DashboardContent";
import { BULK_DELETE_CONCURRENCY } from "@/features/dashboard/components/bulk-delete";

// Full dashboard render with ten cards (each with its own menu) is slow
// under jsdom on a loaded machine; the default 5s limit flakes.
vi.setConfig({ testTimeout: 20_000 });

let inFlight = 0;
let maxInFlight = 0;
let started: string[] = [];
let restored: string[] = [];
let respond: (id: string) => Response;
let respondRestore: (id: string) => Response;

function problem(status: number, detail: string, headers = {}) {
  return new Response(JSON.stringify({ status, detail }), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
}

const fetchMock = vi.fn(
  async (input: RequestInfo | URL, init?: RequestInit) => {
    const parts = String(input).split("/");
    const isRestore = parts.at(-1) === "restore";
    const id = (isRestore ? parts.at(-2) : parts.at(-1))!;
    if (isRestore) {
      expect(init?.method).toBe("POST");
      restored.push(id);
    } else {
      expect(init?.method).toBe("DELETE");
      started.push(id);
    }
    inFlight += 1;
    maxInFlight = Math.max(maxInFlight, inFlight);
    await new Promise((resolve) => setTimeout(resolve, 5));
    inFlight -= 1;
    return isRestore ? respondRestore(id) : respond(id);
  },
);

beforeEach(() => {
  inFlight = 0;
  maxInFlight = 0;
  started = [];
  restored = [];
  respond = () => new Response(JSON.stringify({ success: true }));
  respondRestore = (id) => new Response(JSON.stringify({ id }));
  fetchMock.mockClear();
  state.setQueriesData.mockClear();
  state.invalidateQueries.mockClear();
  Object.values(state.toast).forEach((fn) => fn.mockClear());
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

async function deleteAll() {
  render(<DashboardContent />);
  fireEvent.click(screen.getByRole("button", { name: "Select" }));
  fireEvent.click(screen.getByRole("button", { name: "Select all" }));
  fireEvent.click(screen.getByRole("button", { name: "Delete" }));
  await screen.findByText("Move 10 canvases to Trash?");
  fireEvent.click(screen.getByRole("button", { name: "Move to Trash" }));
}

/** The options of the toast that announced the delete. */
function undoOptions(kind: "success" | "warning") {
  const call = state.toast[kind].mock.calls[0] as unknown[];
  return call[1] as {
    duration: number;
    action: { label: string; onClick: () => void };
  };
}

describe("dashboard bulk delete", () => {
  it("says the canvases go to Trash for 30 days, never that it cannot be undone", async () => {
    render(<DashboardContent />);
    fireEvent.click(screen.getByRole("button", { name: "Select" }));
    fireEvent.click(screen.getByRole("button", { name: "Select all" }));
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    const dialog = await screen.findByRole("dialog");
    expect(dialog.textContent).toContain("Move 10 canvases to Trash?");
    expect(dialog.textContent).toContain(
      "You can restore them from Trash for 30 days.",
    );
    expect(dialog.textContent).not.toMatch(/cannot be undone/i);
    expect(screen.getByRole("button", { name: "Cancel" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Move to Trash" })).toBeTruthy();
  });

  it("bounds in-flight deletes and clears the selection on success", async () => {
    await deleteAll();
    await waitFor(() => expect(state.toast.success).toHaveBeenCalled());
    expect(started).toHaveLength(10);
    expect(maxInFlight).toBeLessThanOrEqual(BULK_DELETE_CONCURRENCY);
    expect(state.toast.success.mock.calls[0][0]).toBe(
      "10 canvases moved to Trash",
    );
    const options = undoOptions("success");
    expect(options.action.label).toBe("Undo");
    expect(options.duration).toBeGreaterThanOrEqual(8_000);
    expect(state.setQueriesData).toHaveBeenCalled();
  });

  it("Undo restores every moved canvas, a few at a time, and refreshes the list", async () => {
    await deleteAll();
    await waitFor(() => expect(state.toast.success).toHaveBeenCalled());
    maxInFlight = 0;
    state.invalidateQueries.mockClear();
    undoOptions("success").action.onClick();
    await waitFor(() =>
      expect(state.toast.success).toHaveBeenCalledWith("Restored"),
    );
    expect([...restored].sort()).toEqual(CANVASES.map((c) => c.id).sort());
    expect(maxInFlight).toBeLessThanOrEqual(BULK_DELETE_CONCURRENCY);
    expect(state.invalidateQueries).toHaveBeenCalledWith(
      expect.objectContaining({ queryKey: ["canvases"] }),
    );
    expect(state.invalidateQueries).toHaveBeenCalledWith(
      expect.objectContaining({ queryKey: ["trash"] }),
    );
  });

  it("Undo says how many canvases are still in Trash when some restores fail", async () => {
    respondRestore = (id) =>
      id === "c3" || id === "c7"
        ? problem(500, "Database unavailable")
        : new Response(JSON.stringify({ id }));
    await deleteAll();
    await waitFor(() => expect(state.toast.success).toHaveBeenCalled());
    undoOptions("success").action.onClick();
    await waitFor(() => expect(state.toast.warning).toHaveBeenCalled());
    expect(state.toast.warning.mock.calls[0][0]).toBe(
      "Restored 8 canvases. 2 canvases could not be restored and are still in Trash.",
    );
  });

  it("offers Undo for the canvases that did move when others did not", async () => {
    respond = (id) =>
      id === "c4"
        ? problem(500, "Database unavailable")
        : new Response(JSON.stringify({ success: true }));
    await deleteAll();
    await waitFor(() => expect(state.toast.warning).toHaveBeenCalled());
    expect(String(state.toast.warning.mock.calls[0][0])).toContain(
      "9 canvases moved to Trash, 1 not moved.",
    );
    undoOptions("warning").action.onClick();
    await waitFor(() =>
      expect(state.toast.success).toHaveBeenCalledWith("Restored"),
    );
    expect(restored).toHaveLength(9);
    expect(restored).not.toContain("c4");
  });

  it("stops after a 429, hints at Retry-After and keeps unsent canvases selected", async () => {
    respond = (id) =>
      id === "c1"
        ? problem(429, "Rate limit exceeded. Please try again later.", {
            "retry-after": "37",
          })
        : new Response(JSON.stringify({ success: true }));
    await deleteAll();
    await waitFor(() => expect(state.toast.warning).toHaveBeenCalled());
    expect(started.length).toBeLessThan(10);
    expect(maxInFlight).toBeLessThanOrEqual(BULK_DELETE_CONCURRENCY);
    const message = String(state.toast.warning.mock.calls[0][0]);
    expect(message).toMatch(/rate limit/i);
    expect(message).toContain("37 seconds");
    const kept = 10 - (started.length - 1);
    expect(screen.getByText(`${kept} selected`)).toBeTruthy();
    // No refetch is forced into the exhausted window.
    expect(state.invalidateQueries).toHaveBeenCalledWith(
      expect.objectContaining({ refetchType: "none" }),
    );
  });

  it("shows the server detail when every delete fails", async () => {
    respond = () => problem(500, "Database unavailable");
    await deleteAll();
    await waitFor(() => expect(state.toast.error).toHaveBeenCalled());
    expect(String(state.toast.error.mock.calls[0][0])).toContain(
      "Database unavailable",
    );
    expect(screen.getByText("10 selected")).toBeTruthy();
  });
});
