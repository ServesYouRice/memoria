// @vitest-environment happy-dom

import React from "react";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const apiFetch = vi.hoisted(() => vi.fn());

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock("@/lib/hooks/use-debounce", () => ({
  useDebounce: (value: unknown) => value,
}));
vi.mock("@/lib/api/fetch-client", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  apiFetch,
}));

import { GlobalSearchDialog } from "@/components/GlobalSearchDialog";

function result(id: string) {
  return {
    itemId: id,
    canvasId: "c1",
    canvasName: "Canvas",
    itemType: "NOTE",
    content: {},
    tags: [],
    snippet: `snippet ${id}`,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
}

function page(ids: string[], offset: number, hasMore: boolean) {
  return {
    json: async () => ({
      results: ids.map(result),
      totalResults: 3,
      facets: { types: [], tags: [] },
      pagination: { total: 3, limit: 2, offset, hasMore },
    }),
  };
}

beforeEach(() => {
  apiFetch.mockReset();
});
afterEach(cleanup);

describe("GlobalSearchDialog paging", () => {
  it("loads the next page and resets on a new query", async () => {
    apiFetch.mockImplementation(async (url: string) => {
      if (url.includes("offset=2")) return page(["b", "c"], 2, false);
      if (url.includes("q=other")) return page(["z"], 0, false);
      return page(["a", "b"], 0, true);
    });
    render(<GlobalSearchDialog open onClose={vi.fn()} />);
    fireEvent.change(screen.getByLabelText("Search all canvas items"), {
      target: { value: "notes" },
    });
    expect(await screen.findByText("snippet a")).toBeTruthy();

    fireEvent.click(await screen.findByRole("button", { name: /load more/i }));
    expect(await screen.findByText("snippet c")).toBeTruthy();
    expect(apiFetch.mock.calls[1]![0]).toContain("offset=2");
    expect(screen.getAllByText(/^snippet /)).toHaveLength(3);
    expect(screen.queryByRole("button", { name: /load more/i })).toBeNull();

    fireEvent.change(screen.getByLabelText("Search all canvas items"), {
      target: { value: "other" },
    });
    expect(await screen.findByText("snippet z")).toBeTruthy();
    await waitFor(() =>
      expect(screen.getAllByText(/^snippet /)).toHaveLength(1),
    );
  });
});
