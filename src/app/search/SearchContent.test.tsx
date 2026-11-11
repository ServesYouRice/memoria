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
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("@/lib/hooks/use-debounce", () => ({
  useDebounce: <T,>(value: T) => value,
}));

import { SearchContent } from "./SearchContent";

type Row = { itemId: string; itemType: string; snippet: string };
let pages: Record<string, { results: Row[]; hasMore: boolean }[]> = {};

function result(row: Row) {
  return {
    canvasId: "c1",
    canvasName: "Board",
    content: {},
    tags: [],
    createdAt: "2026-11-01T00:00:00.000Z",
    updatedAt: "2026-11-01T00:00:00.000Z",
    ...row,
  };
}

function renderPage() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const view = render(
    <QueryClientProvider client={client}>
      <SearchContent />
    </QueryClientProvider>,
  );
  return { ...view, client };
}

function typeQuery(value: string) {
  fireEvent.change(screen.getByPlaceholderText(/Search your canvases/), {
    target: { value },
  });
}

describe("SearchContent type filter", () => {
  beforeEach(() => {
    pages = {};
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        const params = new URL(url, "http://localhost").searchParams;
        const q = params.get("q") ?? "";
        const offset = Number(params.get("offset") ?? 0);
        const page = pages[q]?.[offset / 50] ?? { results: [], hasMore: false };
        return new Response(
          JSON.stringify({
            results: page.results.map(result),
            pagination: { offset, limit: 50, total: 0, hasMore: page.hasMore },
          }),
        );
      }),
    );
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("resets the filter when the query changes", async () => {
    pages.alpha = [
      {
        results: [
          { itemId: "i1", itemType: "IMAGE", snippet: "an image" },
          { itemId: "n1", itemType: "NOTE", snippet: "a note" },
        ],
        hasMore: false,
      },
    ];
    pages.beta = [
      {
        results: [{ itemId: "n2", itemType: "NOTE", snippet: "beta note" }],
        hasMore: false,
      },
    ];
    renderPage();
    typeQuery("alpha");
    fireEvent.click(await screen.findByText("Images"));
    expect(screen.queryByText("a note")).toBeNull();

    typeQuery("beta");
    expect(await screen.findByText("beta note")).toBeTruthy();
    expect(screen.queryByText(/No results for/)).toBeNull();
  });

  it("keeps a clear control and load more while a filter hides every loaded result", async () => {
    pages.delta = [
      {
        results: [
          { itemId: "i4", itemType: "IMAGE", snippet: "delta image" },
          { itemId: "n4", itemType: "NOTE", snippet: "delta note" },
        ],
        hasMore: true,
      },
    ];
    const { client } = renderPage();
    typeQuery("delta");
    fireEvent.click(await screen.findByText("Images"));
    await screen.findByText("delta image");

    // A refetch now returns only notes: the image filter hides everything
    // loaded and only one type is left.
    pages.delta = [
      {
        results: [{ itemId: "n4", itemType: "NOTE", snippet: "delta note" }],
        hasMore: true,
      },
    ];
    await client.refetchQueries();
    await waitFor(() => expect(screen.queryByText("delta image")).toBeNull());

    expect(
      screen.getByRole("button", { name: "Load more results" }),
    ).toBeTruthy();
    fireEvent.click(screen.getByText("All"));
    expect(await screen.findByText("delta note")).toBeTruthy();
  });
});
