// @vitest-environment happy-dom
/**
 * TASK-243 — bulk delete keeps few DELETEs in flight, stops on a 429, shows
 * the server's reason and keeps failed or unsent canvases selected.
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
vi.mock("@/lib/hooks/use-canvases", () => ({
  canvasKeys: { all: ["canvases"] },
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
import { BULK_DELETE_CONCURRENCY } from "@/features/dashboard/components/bulk-delete";

let inFlight = 0;
let maxInFlight = 0;
let started: string[] = [];
let respond: (id: string) => Response;

function problem(status: number, detail: string, headers = {}) {
  return new Response(JSON.stringify({ status, detail }), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
}

const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
  const id = String(input).split("/").pop()!;
  started.push(id);
  inFlight += 1;
  maxInFlight = Math.max(maxInFlight, inFlight);
  await new Promise((resolve) => setTimeout(resolve, 5));
  inFlight -= 1;
  return respond(id);
});

beforeEach(() => {
  inFlight = 0;
  maxInFlight = 0;
  started = [];
  respond = () => new Response(JSON.stringify({ success: true }));
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
  await screen.findByText(/delete 10 canvases\?/);
  const buttons = screen.getAllByRole("button", { name: "Delete" });
  fireEvent.click(buttons[buttons.length - 1]);
}

describe("dashboard bulk delete", () => {
  it("bounds in-flight deletes and clears the selection on success", async () => {
    await deleteAll();
    await waitFor(() => expect(state.toast.success).toHaveBeenCalled());
    expect(started).toHaveLength(10);
    expect(maxInFlight).toBeLessThanOrEqual(BULK_DELETE_CONCURRENCY);
    expect(state.toast.success.mock.calls[0][0]).toBe("Deleted 10 canvases");
    expect(state.setQueriesData).toHaveBeenCalled();
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
