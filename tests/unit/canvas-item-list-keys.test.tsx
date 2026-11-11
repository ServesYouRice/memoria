// @vitest-environment happy-dom
import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook } from "@testing-library/react";
import { hashKey } from "@tanstack/react-query";
import {
  canvasItemKeys,
  useUpdateCanvasItem,
} from "@/lib/hooks/use-canvas-items";
import { type CanvasItem, ItemType } from "@/types/canvas";

const viewport = { minX: 0, maxX: 1000, minY: 0, maxY: 800, limit: 200 };

function boardKey(canvasId: string) {
  // useCanvasData: useCanvasItems(canvasId, undefined, viewport)
  return canvasItemKeys.list(canvasId, undefined, viewport);
}
function accessibleKey(canvasId: string) {
  return [...canvasItemKeys.list(canvasId), "accessible"] as const;
}

function item(version: number): CanvasItem {
  return {
    id: "item-1",
    canvasId: "A",
    type: ItemType.NOTE,
    positionX: 0,
    positionY: 0,
    width: 100,
    height: 100,
    zIndex: 1,
    content: { text: "Note" },
    version,
    createdAt: new Date(),
    updatedAt: new Date(),
  } as CanvasItem;
}

function seed() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  for (const canvasId of ["A", "B"]) {
    queryClient.setQueryData(boardKey(canvasId), { items: [item(1)] });
    queryClient.setQueryData(accessibleKey(canvasId), {
      pages: [{ items: [] }],
      pageParams: [null],
    });
  }
  return queryClient;
}

afterEach(() => vi.restoreAllMocks());

describe("canvas item list filters", () => {
  it("keeps registered key hashes unchanged", () => {
    expect(hashKey(canvasItemKeys.list("A"))).toBe(
      '["canvas-items","list",{"canvasId":"A"}]',
    );
    expect(hashKey(boardKey("A"))).toBe(
      hashKey([
        "canvas-items",
        "list",
        { canvasId: "A", type: undefined, viewport },
      ]),
    );
  });

  it("invalidates canvas A's board viewport and accessible lists only", async () => {
    const queryClient = seed();
    await queryClient.invalidateQueries({
      queryKey: canvasItemKeys.list("A"),
    });
    const state = (key: readonly unknown[]) =>
      queryClient.getQueryState(key)?.isInvalidated;
    expect(state(boardKey("A"))).toBe(true);
    expect(state(accessibleKey("A"))).toBe(true);
    expect(state(boardKey("B"))).toBe(false);
    expect(state(accessibleKey("B"))).toBe(false);
  });

  it("stores the server's new version in the board list after an HTTP update", async () => {
    const queryClient = seed();
    let serverVersion = 1;
    const bodies: Array<{ version?: number }> = [];
    vi.spyOn(globalThis, "fetch").mockImplementation(async (_url, init) => {
      const body = JSON.parse(String(init?.body)) as {
        version?: number;
        positionX?: number;
      };
      bodies.push(body);
      if (body.version !== serverVersion) {
        return new Response(JSON.stringify({ detail: "Version mismatch" }), {
          status: 409,
        });
      }
      serverVersion += 1;
      return new Response(
        JSON.stringify({
          ...item(serverVersion),
          positionX: body.positionX,
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    });
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );
    const { result } = renderHook(() => useUpdateCanvasItem(), { wrapper });
    const boardItem = () =>
      queryClient.getQueryData<{ items: CanvasItem[] }>(boardKey("A"))!
        .items[0]!;

    await act(async () => {
      await result.current.mutateAsync({
        itemId: "item-1",
        data: { positionX: 10, version: boardItem().version },
      });
    });
    expect(boardItem().version).toBe(2);

    await act(async () => {
      await result.current.mutateAsync({
        itemId: "item-1",
        data: { positionX: 20, version: boardItem().version },
      });
    });
    expect(bodies[1]!.version).toBe(2);
    expect(boardItem().version).toBe(3);
    // Canvas B's board list is untouched.
    expect(
      queryClient.getQueryData<{ items: CanvasItem[] }>(boardKey("B"))!
        .items[0]!.version,
    ).toBe(1);
  });
});
