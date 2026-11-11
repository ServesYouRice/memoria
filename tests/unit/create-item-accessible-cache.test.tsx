// @vitest-environment happy-dom
import React from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  canvasItemKeys,
  useCreateCanvasItem,
} from "@/lib/hooks/use-canvas-items";
import { ItemType } from "@/types/canvas";

const accessibleKey = [...canvasItemKeys.list("c1"), "accessible"] as const;

afterEach(() => vi.restoreAllMocks());

async function createWith(seed: unknown) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  // A query registered with no data yet (first page pending or failed).
  queryClient.getQueryCache().build(queryClient, { queryKey: accessibleKey });
  if (seed !== undefined) queryClient.setQueryData(accessibleKey, seed);
  queryClient.setQueryData(canvasItemKeys.list("c1"), { items: [] });

  let release: () => void = () => {};
  vi.spyOn(globalThis, "fetch").mockImplementation(
    () =>
      new Promise((resolve) => {
        release = () =>
          resolve(
            new Response(JSON.stringify({ detail: "no" }), { status: 500 }),
          );
      }),
  );
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  const { result } = renderHook(() => useCreateCanvasItem(), { wrapper });
  let pending: Promise<unknown> = Promise.resolve();
  await act(async () => {
    pending = result.current
      .mutateAsync({
        canvasId: "c1",
        type: ItemType.NOTE,
        positionX: 0,
        positionY: 0,
        width: 100,
        height: 100,
        content: { text: "hi" },
      })
      .catch(() => {});
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  const during = queryClient.getQueryData(accessibleKey);
  const flat = queryClient.getQueryData<{ items: unknown[] }>(
    canvasItemKeys.list("c1"),
  );
  await act(async () => {
    release();
    await pending;
  });
  return { during, flat, after: queryClient.getQueryData(accessibleKey) };
}

describe("optimistic create and the accessible infinite query", () => {
  it("leaves an accessible query with no data undefined", async () => {
    const { during, flat, after } = await createWith(undefined);
    expect(during).toBeUndefined();
    expect(after).toBeUndefined();
    expect(flat?.items).toHaveLength(1);
  });

  it("keeps paged data in {pages, pageParams} form", async () => {
    const paged = { pages: [{ items: [], total: 0 }], pageParams: [undefined] };
    const { during, after } = await createWith(paged);
    expect(during).toEqual(paged);
    expect(during).not.toHaveProperty("items");
    expect(after).toEqual(paged);
  });
});
