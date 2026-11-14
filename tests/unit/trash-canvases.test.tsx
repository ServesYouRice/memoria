// @vitest-environment happy-dom
/**
 * IMP-133: the Trash page lists deleted canvases above the deleted items,
 * each with a Restore button that brings the canvas back.
 */

import React from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock("sonner", () => ({ toast }));
vi.mock("next/link", () => ({
  default: React.forwardRef<HTMLAnchorElement, React.ComponentProps<"a">>(
    function Link({ children, href, ...props }, ref) {
      return (
        <a ref={ref} href={href} {...props}>
          {children}
        </a>
      );
    },
  ),
}));

import { TrashContent } from "@/app/trash/TrashContent";

const tripCanvas = {
  id: "c-trips",
  name: "Trips",
  deletedAt: new Date(Date.now() - 2 * 86_400_000).toISOString(),
  itemCount: 12,
};
const deletedNote = {
  id: "i-1",
  type: "NOTE",
  content: { text: "Buy stamps" },
  version: 2,
  deletedAt: new Date(Date.now() - 3_600_000).toISOString(),
  archivedAt: null,
  canvas: { id: "c-home", name: "Home" },
};

let trashed: (typeof tripCanvas)[];
let items: (typeof deletedNote)[];
let restoreStatus: number;
const fetchMock = vi.fn(
  async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.startsWith("/api/v1/trash")) {
      return Response.json({
        items,
        canvases: trashed,
        pagination: { offset: 0, limit: 50, hasMore: false },
      });
    }
    const restore = /^\/api\/v1\/canvases\/([^/]+)\/restore$/.exec(url);
    if (restore && init?.method === "POST") {
      if (restoreStatus !== 200)
        return Response.json(
          {
            status: restoreStatus,
            detail: "canvases limit of 200 has been reached.",
          },
          { status: restoreStatus },
        );
      trashed = trashed.filter((canvas) => canvas.id !== restore[1]);
      return Response.json({ id: restore[1], name: "Trips", deletedAt: null });
    }
    throw new Error(`Unexpected request ${init?.method ?? "GET"} ${url}`);
  },
);

function renderTrash() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <TrashContent />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  trashed = [tripCanvas];
  items = [deletedNote];
  restoreStatus = 200;
  fetchMock.mockClear();
  toast.success.mockClear();
  toast.error.mockClear();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("Trash page canvases (IMP-133)", () => {
  it("lists a deleted canvas with its size, age and a Restore button", async () => {
    renderTrash();
    expect(
      screen.getByText("Kept for 30 days, then removed for good."),
    ).toBeTruthy();
    const section = (await screen.findByRole("heading", { name: "Canvases" }))
      .parentElement!;
    expect(within(section).getByText("Trips")).toBeTruthy();
    expect(
      within(section).getByText("Canvas · 12 items · deleted 2 days ago"),
    ).toBeTruthy();
    expect(
      within(section).getByRole("button", { name: "Restore Trips" }),
    ).toBeTruthy();
    // Both sections have rows, so the items get their own heading.
    expect(screen.getByRole("heading", { name: "Items" })).toBeTruthy();
    expect(screen.getByText("Buy stamps")).toBeTruthy();
    expect(screen.queryByText("Trash is empty")).toBeNull();
  });

  it("restores the canvas through the route and removes its row", async () => {
    renderTrash();
    fireEvent.click(
      await screen.findByRole("button", { name: "Restore Trips" }),
    );
    await waitFor(() =>
      expect(toast.success).toHaveBeenCalledWith("Canvas restored"),
    );
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/v1/canvases/c-trips/restore",
      expect.objectContaining({ method: "POST" }),
    );
    await waitFor(() => expect(screen.queryByText("Trips")).toBeNull());
    expect(screen.queryByRole("heading", { name: "Canvases" })).toBeNull();
    // With only items left, they need no heading of their own.
    expect(screen.queryByRole("heading", { name: "Items" })).toBeNull();
    expect(screen.getByText("Buy stamps")).toBeTruthy();
  });

  it("keeps the row and says why when the restore is refused", async () => {
    restoreStatus = 422;
    renderTrash();
    fireEvent.click(
      await screen.findByRole("button", { name: "Restore Trips" }),
    );
    await waitFor(() => expect(toast.error).toHaveBeenCalled());
    expect(String(toast.error.mock.calls[0][0])).toContain("limit");
    expect(screen.getByText("Trips")).toBeTruthy();
  });

  it("shows the empty state only when there are no canvases and no items", async () => {
    items = [];
    renderTrash();
    expect(await screen.findByText("Trips")).toBeTruthy();
    expect(screen.queryByText("Trash is empty")).toBeNull();
    cleanup();

    trashed = [];
    renderTrash();
    expect(await screen.findByText("Trash is empty")).toBeTruthy();
  });
});
