// @vitest-environment happy-dom

import React from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const toastError = vi.hoisted(() => vi.fn());
const apiFetch = vi.hoisted(() => vi.fn());

vi.mock("sonner", () => ({ toast: { error: toastError } }));
vi.mock("@/lib/api/fetch-client", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  apiFetch,
}));

import {
  canvasItemKeys,
  useDeleteCanvasItem,
} from "@/lib/hooks/use-canvas-items";
import type { CanvasItem } from "@/types/canvas";

const item = { id: "item-1", canvasId: "canvas-1", version: 3 } as CanvasItem;
const listKey = canvasItemKeys.list("canvas-1");

function setup() {
  const queryClient = new QueryClient({
    defaultOptions: { mutations: { retry: false } },
  });
  queryClient.setQueryData(listKey, { items: [item] });
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  const hook = renderHook(() => useDeleteCanvasItem(), { wrapper });
  return { queryClient, ...hook };
}

const variables = { itemId: item.id, version: item.version };

beforeEach(() => {
  toastError.mockReset();
  apiFetch.mockReset();
});
afterEach(cleanup);

describe("failed item delete", () => {
  it("shows a toast and restores the item when the HTTP delete fails", async () => {
    apiFetch.mockResolvedValue({
      ok: false,
      json: async () => ({ detail: "Version conflict" }),
    });
    const { result, queryClient } = setup();

    await act(async () => {
      await result.current.mutateAsync(variables).catch(() => {});
    });

    await waitFor(() => expect(toastError).toHaveBeenCalledTimes(1));
    expect(
      queryClient.getQueryData<{ items: CanvasItem[] }>(listKey)?.items,
    ).toEqual([item]);
  });

  it("shows a toast when the request itself rejects", async () => {
    apiFetch.mockRejectedValue(new Error("offline"));
    const { result } = setup();

    await act(async () => {
      await result.current.mutateAsync(variables).catch(() => {});
    });

    expect(toastError).toHaveBeenCalledTimes(1);
  });

  it("removes the item without a toast when the delete succeeds", async () => {
    apiFetch.mockResolvedValue({ ok: true, json: async () => ({}) });
    const { result, queryClient } = setup();

    await act(async () => {
      await result.current.mutateAsync(variables);
    });

    expect(toastError).not.toHaveBeenCalled();
    expect(
      queryClient.getQueryData<{ items: CanvasItem[] }>(listKey)?.items ?? [],
    ).not.toContainEqual(item);
  });
});
