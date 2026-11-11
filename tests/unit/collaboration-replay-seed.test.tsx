// @vitest-environment happy-dom
/**
 * TASK-187 — the first replay of a canvas session starts after the event
 * revision read before the board's item load, not from cursor 0.
 */

import { act, renderHook } from "@testing-library/react";
import { QueryClient } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/logger", () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

const apiFetch = vi.hoisted(() => vi.fn());
vi.mock("@/lib/api/fetch-client", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  apiFetch: (...args: unknown[]) => apiFetch(...args),
}));

import { useCollaboration } from "@/lib/hooks/use-collaboration";
import * as canvasItems from "@/lib/hooks/use-canvas-items";

const { canvasItemKeys, listItemsOrOfflinePlaceholder } = canvasItems;

class MockWebSocket {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;
  static instances: MockWebSocket[] = [];
  readyState = MockWebSocket.CONNECTING;
  binaryType = "blob";
  onopen: ((event: Event) => void) | null = null;
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  onclose: ((event: CloseEvent) => void) | null = null;
  readonly send = vi.fn<(data: string) => void>();
  constructor() {
    MockWebSocket.instances.push(this);
  }
  open(): void {
    this.readyState = MockWebSocket.OPEN;
    this.onopen?.(new Event("open"));
  }
  receive(value: unknown): void {
    this.onmessage?.({ data: JSON.stringify(value) } as MessageEvent);
  }
  close(code = 1000): void {
    if (this.readyState === MockWebSocket.CLOSED) return;
    this.readyState = MockWebSocket.CLOSED;
    this.onclose?.({ code } as CloseEvent);
  }
}

const CANVAS = "cjld2cjxh0000qzrmn831i7rn";
const json = (body: unknown) =>
  ({ ok: true, status: 200, json: async () => body }) as unknown as Response;
const itemPage = () =>
  json({
    items: [],
    total: 0,
    offset: 0,
    limit: 100,
    hasMore: false,
    nextCursor: null,
    truncatedByBytes: false,
  });
const envelope = (cursor: number, canvasCursor: number) => ({
  schemaVersion: 1,
  cursor: String(cursor),
  canvasCursor: String(canvasCursor),
  operation: "updated",
  entity: { type: "canvas-item", id: `item-${cursor}`, version: 2 },
});

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.useFakeTimers();
  MockWebSocket.instances = [];
  vi.stubGlobal("WebSocket", MockWebSocket);
  fetchMock = vi.fn(async () =>
    json({ events: [], nextCursor: "0", hasMore: false }),
  );
  vi.stubGlobal("fetch", fetchMock);
  apiFetch.mockReset();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

async function flush() {
  await act(async () => {
    for (let index = 0; index < 10; index += 1) await Promise.resolve();
  });
}

async function connect(extra: Record<string, unknown>) {
  const onCommittedEvents = vi.fn();
  const onSnapshotRequired = vi.fn();
  const hook = renderHook(() =>
    useCollaboration({
      canvasId: CANVAS,
      userId: "user-1",
      email: "user@example.com",
      onCommittedEvents,
      onSnapshotRequired,
      ...extra,
    }),
  );
  const socket = MockWebSocket.instances.at(-1)!;
  await act(async () => {
    socket.open();
    await Promise.resolve();
  });
  await flush();
  await act(async () => {
    await vi.advanceTimersByTimeAsync(200);
  });
  const delivered = () =>
    onCommittedEvents.mock.calls.flatMap(([events]) =>
      events.map((event: { cursor: string }) => event.cursor),
    );
  return { ...hook, socket, delivered, onSnapshotRequired };
}

describe("first committed-event replay", () => {
  it("starts after the seed and applies what was committed since (VAL-239)", async () => {
    fetchMock.mockImplementation(async (url: string) =>
      String(url).includes("cursor=500&")
        ? json({
            events: [envelope(501, 8)],
            nextCursor: "501",
            hasMore: false,
          })
        : // Replaying from the beginning would resend the whole history.
          json({
            events: Array.from({ length: 200 }, (_, index) =>
              envelope(index + 1, index + 1),
            ),
            nextCursor: "200",
            hasMore: true,
          }),
    );
    const { socket, delivered, onSnapshotRequired, unmount } = await connect({
      getInitialEventSeed: () => ({ cursor: "500", canvasSequence: "7" }),
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0]![0])).toContain("cursor=500&");
    expect(delivered()).toEqual(["501"]);
    expect(onSnapshotRequired).not.toHaveBeenCalled();

    // The seed's per-canvas number feeds live gap detection: the canvas's
    // ninth event follows without a replay.
    act(() =>
      socket.receive({ type: "committed-event", event: envelope(530, 9) }),
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(200);
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(delivered()).toEqual(["501", "530"]);
    unmount();
  });

  it("falls back to the beginning without a seed", async () => {
    const { unmount } = await connect({ getInitialEventSeed: () => null });
    expect(String(fetchMock.mock.calls[0]![0])).toContain("cursor=0&");
    unmount();
  });
});

describe("the item load's event seed", () => {
  it("is read before the items and kept with them", async () => {
    const calls: string[] = [];
    apiFetch.mockImplementation(async (url: string) => {
      calls.push(url);
      return url.includes("/summary")
        ? json({ revision: "500", canvasRevision: "7" })
        : itemPage();
    });
    const loaded = await listItemsOrOfflinePlaceholder(CANVAS);
    expect(calls).toHaveLength(2);
    expect(calls[0]).toContain("/api/v1/canvas-items/summary?");
    expect(calls[0]).toContain("revisionOnly=1");
    expect(calls[1]).toContain("/api/v1/canvas-items?");
    expect(loaded).toMatchObject({
      eventSeed: { cursor: "500", canvasSequence: "7" },
    });
  });

  it("loads the items without a seed when the revision read fails", async () => {
    apiFetch.mockImplementation(async (url: string) => {
      if (url.includes("/summary")) throw new TypeError("network");
      return itemPage();
    });
    const loaded = await listItemsOrOfflinePlaceholder(CANVAS);
    expect(loaded).toMatchObject({ items: [], eventSeed: null });
  });

  it("offers a canvas session the earliest seed among its cached item lists", () => {
    const queryClient = new QueryClient();
    const page = (cursor: string | null) => ({
      items: [],
      eventSeed: cursor ? { cursor, canvasSequence: "1" } : null,
    });
    const viewport = (minX: number) => ({ minX, maxX: 1, minY: 0, maxY: 1 });
    expect(canvasItems.getCanvasEventSeed(queryClient, CANVAS)).toBeNull();
    queryClient.setQueryData(
      canvasItemKeys.list(CANVAS, undefined, viewport(0)),
      page("700"),
    );
    queryClient.setQueryData(
      canvasItemKeys.list(CANVAS, undefined, viewport(5)),
      page("650"),
    );
    queryClient.setQueryData(canvasItemKeys.list(CANVAS, "NOTE"), page(null));
    queryClient.setQueryData(
      canvasItemKeys.list("cjld2cjxh0001qzrmn831i7ro"),
      page("10"),
    );
    expect(canvasItems.getCanvasEventSeed(queryClient, CANVAS)).toEqual({
      cursor: "650",
      canvasSequence: "1",
    });
  });
});
