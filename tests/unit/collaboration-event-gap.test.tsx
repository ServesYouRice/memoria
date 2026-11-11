// @vitest-environment happy-dom
/**
 * TASK-020 / TASK-188 — live gap detection follows the contiguous per-canvas
 * event number, not the global `CanvasEvent.sequence`, which other canvases
 * and rolled-back transactions leave holes in.
 */

import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/logger", () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

import * as collaboration from "@/lib/hooks/use-collaboration";

const { useCollaboration } = collaboration;

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

/** A canvas event: global `cursor`, per-canvas `canvasCursor`. */
function envelope(cursor: number, canvasCursor?: number) {
  return {
    schemaVersion: 1,
    cursor: String(cursor),
    ...(canvasCursor === undefined
      ? {}
      : { canvasCursor: String(canvasCursor) }),
    operation: "updated",
    entity: { type: "canvas-item", id: `item-${cursor}`, version: 2 },
  };
}
const live = (cursor: number, canvasCursor?: number) => ({
  type: "committed-event",
  event: envelope(cursor, canvasCursor),
});

let fetchMock: ReturnType<typeof vi.fn>;
const replayCalls = () =>
  fetchMock.mock.calls
    .map(([url]) => String(url))
    .filter((url) => !url.includes("cursor=0&"));

beforeEach(() => {
  vi.useFakeTimers();
  MockWebSocket.instances = [];
  vi.stubGlobal("WebSocket", MockWebSocket);
  // A runaway replay loop must fail the test, not exhaust memory: past this
  // many requests every request hangs.
  fetchMock = vi.fn(async () =>
    fetchMock.mock.calls.length > 30
      ? new Promise<Response>(() => {})
      : json({ events: [], nextCursor: "0", hasMore: false }),
  );
  vi.stubGlobal("fetch", fetchMock);
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

async function connected() {
  const onCommittedEvents = vi.fn();
  const hook = renderHook(() =>
    useCollaboration({
      canvasId: CANVAS,
      userId: "user-1",
      email: "user@example.com",
      onCommittedEvents,
    }),
  );
  const socket = MockWebSocket.instances.at(-1)!;
  await act(async () => {
    socket.open();
    await Promise.resolve();
  });
  await flush();
  const delivered = () =>
    onCommittedEvents.mock.calls.flatMap(([events]) =>
      events.map((event: { cursor: string }) => event.cursor),
    );
  return { ...hook, socket, delivered };
}

async function settle() {
  await flush();
  await act(async () => {
    await vi.advanceTimersByTimeAsync(200);
  });
}

describe("live committed-event gap detection", () => {
  it("does not replay when the global sequence jumps because another canvas wrote events (VAL-027)", async () => {
    const { socket, delivered, unmount } = await connected();
    act(() => socket.receive(live(10, 1)));
    // Canvas B took 11..14; this canvas's next event is its second.
    act(() => socket.receive(live(15, 2)));
    await settle();
    expect(replayCalls()).toEqual([]);
    expect(delivered()).toEqual(["10", "15"]);
    unmount();
  });

  it("replays when this canvas's own predecessor is missing (VAL-027)", async () => {
    const { socket, delivered, unmount } = await connected();
    fetchMock.mockImplementation(async (url: string) =>
      String(url).includes("cursor=10&")
        ? json({
            events: [envelope(12, 2), envelope(15, 3)],
            nextCursor: "15",
            hasMore: false,
          })
        : json({ events: [], nextCursor: "0", hasMore: false }),
    );
    act(() => socket.receive(live(10, 1)));
    act(() => socket.receive(live(15, 3)));
    await settle();
    expect(replayCalls()).toHaveLength(1);
    expect(replayCalls()[0]).toContain("cursor=10&");
    expect(delivered()).toEqual(["10", "12", "15"]);
    unmount();
  });

  it("accepts an event that carries no per-canvas number without a replay", async () => {
    const { socket, delivered, unmount } = await connected();
    act(() => socket.receive(live(10, 1)));
    act(() => socket.receive(live(15)));
    await settle();
    expect(replayCalls()).toEqual([]);
    expect(delivered()).toEqual(["10", "15"]);
    unmount();
  });
});

describe("isCommittedEventGap", () => {
  const gap = (last: bigint | null, canvasCursor?: string) =>
    collaboration.isCommittedEventGap(last, { canvasCursor });

  it("compares the per-canvas number with the last one applied", () => {
    expect(gap(10n, "11")).toBe(false);
    expect(gap(10n, "12")).toBe(true);
    expect(gap(10n, "10")).toBe(false);
  });

  it("reports no gap without a number on either side", () => {
    expect(gap(10n, undefined)).toBe(false);
    expect(gap(null, "12")).toBe(false);
  });
});
