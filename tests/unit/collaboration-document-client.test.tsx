// @vitest-environment happy-dom
/**
 * IMP-042: the board's view of the collaborative document and the item
 * mutation hooks' choice between the document and the HTTP API.
 */
import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, act } from "@testing-library/react";
import {
  canvasItemKeys,
  useCreateCanvasItem,
  useDeleteCanvasItem,
  useUpdateCanvasItem,
} from "@/lib/hooks/use-canvas-items";
import { CanvasDocumentContext } from "@/lib/hooks/use-canvas-document";
import {
  createDocumentItemCache,
  overlayDocumentItems,
} from "@/lib/collaboration/sync/canvas-view";
import type {
  CanvasDocumentEntry,
  CanvasDocumentSession,
} from "@/lib/collaboration/sync/client-session";
import type { CanvasItemState } from "@/lib/collaboration/sync/document-items";
import { type CanvasItem, ItemType } from "@/types/canvas";

const CANVAS_ID = "ckcanvas000000000000000001";

function state(
  id: string,
  overrides: Partial<CanvasItemState> = {},
): CanvasItemState {
  return {
    id,
    type: ItemType.SHAPE,
    positionX: 0,
    positionY: 0,
    width: 100,
    height: 100,
    zIndex: 0,
    tags: [],
    content: { shape: "rectangle", fill: "#ffffff" },
    ...overrides,
  };
}

function entries(...states: CanvasItemState[]) {
  return new Map<string, CanvasDocumentEntry>(
    states.map((item) => [item.id, { state: item, changedAt: null }]),
  );
}

function row(id: string, overrides: Partial<CanvasItem> = {}): CanvasItem {
  return {
    ...state(id),
    canvasId: CANVAS_ID,
    content: { shape: "rectangle", fill: "#ffffff" } as CanvasItem["content"],
    version: 7,
    deletedAt: null,
    createdById: "user-1",
    updatedById: "user-2",
    deletedById: null,
    createdAt: new Date("2026-01-01T00:00:00Z"),
    updatedAt: new Date("2026-01-02T00:00:00Z"),
    ...overrides,
  } as CanvasItem;
}

describe("overlayDocumentItems", () => {
  const window = { minX: 0, maxX: 1000, minY: 0, maxY: 1000, limit: 2 };

  it("shows the document's items in the window, in the list order and limit", () => {
    const view = overlayDocumentItems({
      canvasId: CANVAS_ID,
      entries: entries(
        state("c3", { zIndex: 5 }),
        state("c1", { zIndex: 1 }),
        state("c2", { zIndex: 1 }),
        state("cfar", { positionX: 5_000 }),
      ),
      queried: [],
      window,
    });
    expect(view.map((item) => item.id)).toEqual(["c1", "c2"]);
  });

  it("applies the window's tag filter", () => {
    const view = overlayDocumentItems({
      canvasId: CANVAS_ID,
      entries: entries(
        state("c1", { tags: ["a"] }),
        state("c2", { tags: ["a", "b"] }),
      ),
      queried: [],
      window: { ...window, tags: ["a", "b"] },
    });
    expect(view.map((item) => item.id)).toEqual(["c2"]);
  });

  it("takes geometry and content from the document and metadata from rows", () => {
    const [item] = overlayDocumentItems({
      canvasId: CANVAS_ID,
      entries: entries(state("c1", { positionX: 42, tags: ["live"] })),
      queried: [row("c1", { positionX: 1, tags: ["stale"] })],
      window,
    });
    expect(item).toMatchObject({
      id: "c1",
      positionX: 42,
      tags: ["live"],
      version: 7,
      createdById: "user-1",
    });
    expect(item.updatedAt).toEqual(new Date("2026-01-02T00:00:00Z"));
  });

  it("renders items the rows do not know yet", () => {
    const [item] = overlayDocumentItems({
      canvasId: CANVAS_ID,
      entries: entries(state("cnew")),
      queried: [],
      window,
    });
    expect(item).toMatchObject({
      id: "cnew",
      canvasId: CANVAS_ID,
      version: 1,
      deletedAt: null,
    });
  });

  it("keeps unchanged items identical and re-renders changed ones", () => {
    const cache = createDocumentItemCache();
    const first = entries(state("c1"), state("c2"));
    const before = overlayDocumentItems({
      canvasId: CANVAS_ID,
      entries: first,
      queried: [],
      window,
      cache,
    });
    const changedAt = new Date();
    const second = new Map(first);
    second.set("c2", {
      state: state("c2", { positionX: 9 }),
      changedAt,
    });
    const after = overlayDocumentItems({
      canvasId: CANVAS_ID,
      entries: second,
      queried: [],
      window,
      cache,
    });
    expect(after[0]).toBe(before[0]);
    expect(after[1]).not.toBe(before[1]);
    expect(after[1].updatedAt).toBe(changedAt);
  });
});

function fakeSession(options: { writable: boolean; items: string[] }) {
  const created: unknown[] = [];
  const updated: Array<[string, unknown]> = [];
  const deleted: string[] = [];
  const session = {
    canvasId: CANVAS_ID,
    get acceptsWrites() {
      return options.writable;
    },
    hasItem: (itemId: string) => options.items.includes(itemId),
    createItem: (input: { type: ItemType }) => {
      created.push(input);
      return state("cdocumentitem000000000001", { type: input.type });
    },
    updateItem: (itemId: string, changes: Record<string, unknown>) => {
      updated.push([itemId, changes]);
      return state(itemId, changes);
    },
    deleteItem: (itemId: string) => {
      deleted.push(itemId);
    },
  };
  return {
    session: session as unknown as CanvasDocumentSession,
    created,
    updated,
    deleted,
  };
}

function setup(session: CanvasDocumentSession | null) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  queryClient.setQueryData(canvasItemKeys.list(CANVAS_ID), {
    items: [row("cexisting")],
  });
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={queryClient}>
      <CanvasDocumentContext.Provider value={session}>
        {children}
      </CanvasDocumentContext.Provider>
    </QueryClientProvider>
  );
  return { queryClient, wrapper };
}

const createInput = {
  canvasId: CANVAS_ID,
  type: ItemType.SHAPE,
  positionX: 1,
  positionY: 2,
  width: 30,
  height: 40,
  content: { shape: "rectangle", fill: "#ffffff" },
};

describe("item mutations with an open document", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("writes through a writable document without calling the HTTP API", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const fake = fakeSession({ writable: true, items: ["cexisting"] });
    const { wrapper } = setup(fake.session);

    const create = renderHook(() => useCreateCanvasItem(), { wrapper });
    const update = renderHook(() => useUpdateCanvasItem(), { wrapper });
    const remove = renderHook(() => useDeleteCanvasItem(), { wrapper });

    let createdItem: CanvasItem | undefined;
    let updatedItem: CanvasItem | undefined;
    await act(async () => {
      createdItem = await create.result.current.mutateAsync(createInput);
      updatedItem = await update.result.current.mutateAsync({
        itemId: "cexisting",
        data: { version: 7, positionX: 99 },
      });
      await remove.result.current.mutateAsync({
        itemId: "cexisting",
        version: 7,
      });
    });

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(fake.created).toHaveLength(1);
    expect(createdItem).toMatchObject({
      id: "cdocumentitem000000000001",
      canvasId: CANVAS_ID,
      version: 1,
    });
    // The version is for HTTP writes only; the document merges edits.
    expect(fake.updated).toEqual([["cexisting", { positionX: 99 }]]);
    expect(updatedItem).toMatchObject({
      id: "cexisting",
      positionX: 99,
      version: 7,
      createdById: "user-1",
    });
    expect(fake.deleted).toEqual(["cexisting"]);
  });

  it("uses the HTTP API when the document is read-only or lacks the item", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(
      async () =>
        new Response(JSON.stringify(row("cexisting", { version: 8 })), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
    );
    const readOnly = fakeSession({ writable: false, items: ["cexisting"] });
    const { wrapper } = setup(readOnly.session);
    const update = renderHook(() => useUpdateCanvasItem(), { wrapper });
    await act(async () => {
      await update.result.current.mutateAsync({
        itemId: "cexisting",
        data: { version: 7, positionX: 5 },
      });
    });
    expect(readOnly.updated).toHaveLength(0);
    expect(fetchSpy).toHaveBeenCalledTimes(1);

    const missing = fakeSession({ writable: true, items: [] });
    const second = setup(missing.session);
    const updateMissing = renderHook(() => useUpdateCanvasItem(), {
      wrapper: second.wrapper,
    });
    await act(async () => {
      await updateMissing.result.current.mutateAsync({
        itemId: "cexisting",
        data: { version: 7, positionX: 6 },
      });
    });
    expect(missing.updated).toHaveLength(0);
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });
});
