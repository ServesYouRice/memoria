// @vitest-environment happy-dom

import { renderHook, act, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  ItemType,
  resolveCanvasCapabilities,
  type CanvasItem,
} from "@/types/canvas";
import {
  aggregateGeometryStatus,
  useItemGeometry,
} from "@/features/canvas/hooks/use-item-geometry";

const mutateAsync = vi.fn();
vi.mock("@/lib/hooks/use-canvas-items", () => ({
  useUpdateCanvasItem: () => ({ mutateAsync }),
}));

function item(id: string): CanvasItem {
  return {
    id,
    canvasId: "canvas-1",
    type: ItemType.NOTE,
    positionX: 0,
    positionY: 0,
    width: 100,
    height: 100,
    zIndex: 1,
    version: 1,
    content: {} as CanvasItem["content"],
  } as CanvasItem;
}

beforeEach(() => {
  mutateAsync.mockReset();
});

describe("useItemGeometry aggregate status", () => {
  it("keeps item A's failure visible after item B saves, until A succeeds", async () => {
    const failure = new Error("server down");
    mutateAsync.mockImplementation(async ({ itemId }: { itemId: string }) => {
      if (itemId === "a") throw failure;
      return { version: 2 };
    });
    const { result } = renderHook(() =>
      useItemGeometry({ capabilities: resolveCanvasCapabilities("EDIT") }),
    );
    const a = item("a");
    const b = item("b");

    act(() => {
      result.current.commitGeometry(a, { positionX: 1, positionY: 1 });
    });
    await waitFor(() => expect(result.current.status).toBe("failed"));

    act(() => {
      result.current.commitGeometry(b, { positionX: 2, positionY: 2 });
    });
    await waitFor(() =>
      expect(mutateAsync).toHaveBeenCalledWith(
        expect.objectContaining({ itemId: "b" }),
      ),
    );
    await act(async () => {});
    expect(result.current.status).toBe("failed");
    expect(result.current.error).toBe(failure);

    mutateAsync.mockResolvedValue({ version: 3 });
    act(() => {
      result.current.commitGeometry(a, { positionX: 3, positionY: 3 });
    });
    await waitFor(() => expect(result.current.status).toBe("saved"));
    expect(result.current.error).toBeNull();
  });
});

describe("aggregateGeometryStatus", () => {
  it("prefers an unsaved failure over saving and saved entries", () => {
    const failure = new Error("a failed");
    expect(
      aggregateGeometryStatus([
        { status: "saving", error: null },
        { status: "failed", error: failure },
      ]),
    ).toEqual({ status: "failed", error: failure });
  });

  it("is saving while any entry saves and saved when none remain", () => {
    expect(
      aggregateGeometryStatus([{ status: "saving", error: null }]),
    ).toEqual({ status: "saving", error: null });
    expect(aggregateGeometryStatus([])).toEqual({
      status: "saved",
      error: null,
    });
  });
});

describe("useItemGeometry version refresh", () => {
  it("sends the item's refreshed version after a conflict", async () => {
    const { ApiError } = await import("@/lib/api/fetch-client");
    mutateAsync
      .mockRejectedValueOnce(new ApiError(409, "conflict"))
      .mockResolvedValueOnce({ version: 8 });
    const { result } = renderHook(() =>
      useItemGeometry({ capabilities: resolveCanvasCapabilities("EDIT") }),
    );
    act(() => {
      result.current.commitGeometry(item("a"), { positionX: 1, positionY: 1 });
    });
    await waitFor(() => expect(result.current.status).toBe("conflict"));

    act(() => {
      result.current.commitGeometry(
        { ...item("a"), version: 7 },
        { positionX: 5, positionY: 5 },
      );
    });
    await waitFor(() => expect(result.current.status).toBe("saved"));
    expect(mutateAsync).toHaveBeenLastCalledWith({
      itemId: "a",
      data: { positionX: 5, positionY: 5, version: 7 },
    });
  });
});

describe("useItemGeometry unmount", () => {
  it("makes the final flush the last attempt", async () => {
    vi.useFakeTimers();
    try {
      mutateAsync.mockImplementation(async () => {
        throw new TypeError("offline");
      });
      const { result, unmount } = renderHook(() =>
        useItemGeometry({ capabilities: resolveCanvasCapabilities("EDIT") }),
      );
      act(() => {
        result.current.commitGeometry(item("a"), {
          positionX: 1,
          positionY: 1,
        });
      });
      await act(async () => {});
      const calls = mutateAsync.mock.calls.length;
      unmount();
      await vi.advanceTimersByTimeAsync(120_000);
      // At most the unmount flush; no scheduled retry after disposal.
      expect(mutateAsync.mock.calls.length).toBeLessThanOrEqual(calls + 1);
    } finally {
      vi.useRealTimers();
    }
  });
});
