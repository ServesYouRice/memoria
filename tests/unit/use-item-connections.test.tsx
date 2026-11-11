// @vitest-environment happy-dom
/**
 * TASK-180 — useItemConnections follows the server's pages and returns every
 * connection of the canvas.
 */
import React from "react";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useItemConnections } from "@/lib/hooks/use-item-connections";

function connection(index: number) {
  return {
    id: `conn-${index}`,
    fromId: "a",
    toId: "b",
    label: null,
    style: "SOLID",
    createdAt: new Date(Date.UTC(2026, 0, 1, 0, 0, index)).toISOString(),
  };
}

function wrapper({ children }: { children: React.ReactNode }) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

function serve(
  pages: (
    offset: number,
    limit: number,
  ) => {
    connections: unknown[];
    total: number;
    hasMore: boolean;
  },
) {
  const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    const url = new URL(String(input), "http://localhost");
    const limit = Number(url.searchParams.get("limit") ?? 50);
    const offset = Number(url.searchParams.get("offset") ?? 0);
    const page = pages(offset, limit);
    return new Response(
      JSON.stringify({
        connections: page.connections,
        pagination: { total: page.total, limit, offset, hasMore: page.hasMore },
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("useItemConnections", () => {
  it("returns every connection across server pages, in order, without duplicates", async () => {
    const all = Array.from({ length: 230 }, (_, index) => connection(index));
    // Mirrors the route: default limit 50 when none is sent, ordered by
    // createdAt. The second page repeats one row, as a concurrent insert can.
    serve((offset, limit) => {
      const page = all.slice(offset, offset + limit);
      if (offset > 0) page.unshift(all[offset - 1]);
      return {
        connections: page,
        total: all.length,
        hasMore: offset + limit < all.length,
      };
    });

    const { result } = renderHook(() => useItemConnections("canvas-1"), {
      wrapper,
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data!.connections.map((c) => c.id)).toEqual(
      all.map((c) => c.id),
    );
  });

  it("stops when the server reports more pages but sends an empty one", async () => {
    const fetchMock = serve((offset) => ({
      connections: offset === 0 ? [connection(0)] : [],
      total: 5,
      hasMore: true,
    }));
    const { result } = renderHook(() => useItemConnections("canvas-1"), {
      wrapper,
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data!.connections).toHaveLength(1);
    expect(fetchMock.mock.calls.length).toBeLessThanOrEqual(3);
  });
});
