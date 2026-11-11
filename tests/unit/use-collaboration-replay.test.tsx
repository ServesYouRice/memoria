// @vitest-environment happy-dom

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

import { useCollaboration } from "@/lib/hooks/use-collaboration";

class MockWebSocket {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;
  static instances: MockWebSocket[] = [];

  readonly url: string;
  readyState = MockWebSocket.CONNECTING;
  binaryType = "blob";
  onopen: ((event: Event) => void) | null = null;
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  onclose: ((event: CloseEvent) => void) | null = null;
  readonly send = vi.fn<(data: string) => void>();

  constructor(url: string | URL) {
    this.url = String(url);
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

const CANVAS_A = "cjld2cjxh0000qzrmn831i7rn";
const CANVAS_B = "cjld2cjxh0001qzrmn831i7ro";
const options = {
  canvasId: CANVAS_A,
  userId: "user-1",
  email: "user@example.com",
  name: "Alice",
};

// A minimal response: happy-dom's Response body reads can wait on timers.
const json = (body: unknown) =>
  ({ ok: true, status: 200, json: async () => body }) as unknown as Response;
const empty = () => json({ events: [], nextCursor: "0", hasMore: false });

function committed(cursor: number, id = `item-${cursor}`) {
  return {
    type: "committed-event",
    event: {
      schemaVersion: 1,
      cursor: String(cursor),
      // These canvases are the only writers, so the per-canvas number that
      // gap detection reads equals the global cursor.
      canvasCursor: String(cursor),
      operation: "updated",
      entity: { type: "canvas-item", id, version: 2 },
    },
  };
}

let fetchMock: ReturnType<typeof vi.fn>;
// A runaway replay loop must fail the test, not exhaust memory: past this
// many replay requests every request hangs.
const RUNAWAY = 30;
function replayWith(handler: (url: string) => Promise<Response> | Response) {
  fetchMock.mockImplementation(async (url: string) => {
    if (String(url).includes("cursor=0&")) return empty();
    if (replayCalls().length > RUNAWAY) return new Promise(() => {});
    return handler(String(url));
  });
}
const replayCalls = () =>
  fetchMock.mock.calls.filter(([url]) => !String(url).includes("cursor=0&"));

async function flush() {
  await act(async () => {
    for (let index = 0; index < 10; index += 1) await Promise.resolve();
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  MockWebSocket.instances = [];
  vi.stubGlobal("WebSocket", MockWebSocket);
  fetchMock = vi.fn(async () => empty());
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

async function connected(extra: Record<string, unknown> = {}) {
  const hook = renderHook(
    (props: Record<string, unknown>) =>
      useCollaboration({ ...options, ...props }),
    { initialProps: extra },
  );
  const socket = MockWebSocket.instances.at(-1)!;
  await act(async () => {
    socket.open();
    await Promise.resolve();
  });
  await flush();
  return { ...hook, socket };
}

describe("committed-event replay recovery", () => {
  it("stops retrying a failing replay after a bounded number of spaced attempts", async () => {
    const onSnapshotRequired = vi.fn();
    const { socket, unmount } = await connected({ onSnapshotRequired });
    // Fail every replay; past 30 attempts, hang so a runaway loop cannot spin.
    replayWith(() => {
      throw new TypeError("network down");
    });
    act(() => socket.receive(committed(1)));
    act(() => socket.receive(committed(5)));
    const callTimes: number[] = [];
    for (let step = 0; step < 600; step += 1) {
      const before = replayCalls().length;
      await act(async () => {
        await vi.advanceTimersByTimeAsync(1_000);
      });
      for (let n = before; n < replayCalls().length; n += 1) {
        callTimes.push(step);
      }
    }
    expect(replayCalls().length).toBeGreaterThan(1);
    expect(replayCalls().length).toBeLessThanOrEqual(5);
    const gaps = callTimes
      .slice(1)
      .map((time, index) => time - callTimes[index]!);
    for (let index = 1; index < gaps.length; index += 1) {
      expect(gaps[index]!).toBeGreaterThan(gaps[index - 1]!);
    }
    expect(onSnapshotRequired).toHaveBeenCalledTimes(1);
    unmount();
  });

  it("adopts the server cursor when the replay answers snapshotRequired", async () => {
    const onSnapshotRequired = vi.fn();
    const onCommittedEvents = vi.fn();
    const { socket, unmount } = await connected({
      onSnapshotRequired,
      onCommittedEvents,
    });
    replayWith(() =>
      json({
        events: [],
        nextCursor: "10",
        hasMore: false,
        snapshotRequired: true,
      }),
    );
    act(() => socket.receive(committed(1)));
    act(() => socket.receive(committed(5)));
    await flush();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    });
    expect(replayCalls()).toHaveLength(1);
    expect(onSnapshotRequired).toHaveBeenCalledTimes(1);

    // The next live event after the server cursor needs no replay.
    act(() => socket.receive(committed(11)));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(100);
    });
    expect(replayCalls()).toHaveLength(1);
    const delivered = onCommittedEvents.mock.calls.flatMap(([events]) =>
      events.map((event: { cursor: string }) => event.cursor),
    );
    expect(delivered).toContain("11");
    expect(delivered).not.toContain("5");
    unmount();
  });

  it("does not retry after unmount", async () => {
    const { socket, unmount } = await connected();
    replayWith(() => {
      throw new TypeError("network down");
    });
    act(() => socket.receive(committed(1)));
    act(() => socket.receive(committed(5)));
    await flush();
    const before = replayCalls().length;
    unmount();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(120_000);
    });
    expect(replayCalls().length).toBe(before);
  });

  it("ignores a replay response that arrives after the canvas changed", async () => {
    const onCommittedEvents = vi.fn();
    let release!: (response: Response) => void;
    const { socket, rerender, unmount } = await connected({
      onCommittedEvents,
    });
    fetchMock.mockImplementation(async (url: string) => {
      if (
        String(url).includes(CANVAS_A) &&
        !String(url).includes("cursor=0&")
      ) {
        return new Promise<Response>((resolve) => {
          release = resolve;
        });
      }
      return empty();
    });
    act(() => socket.receive(committed(1)));
    act(() => socket.receive(committed(5)));
    await flush();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(100);
    });
    onCommittedEvents.mockClear();

    rerender({ onCommittedEvents, canvasId: CANVAS_B });
    const socketB = MockWebSocket.instances.at(-1)!;
    expect(socketB).not.toBe(socket);
    await act(async () => {
      socketB.open();
      await Promise.resolve();
    });
    await flush();
    await act(async () => {
      release(
        json({
          events: [
            committed(3, "a-item").event,
            committed(4, "a-item-2").event,
          ],
          nextCursor: "4",
          hasMore: false,
        }),
      );
      await Promise.resolve();
    });
    await flush();
    // Canvas B's first events (cursor 1 and 2) are still accepted.
    act(() => socketB.receive(committed(1, "b-item")));
    act(() => socketB.receive(committed(2, "b-item-2")));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(100);
    });
    const delivered = onCommittedEvents.mock.calls.flatMap(([events]) =>
      events.map((event: { entity: { id: string } }) => event.entity.id),
    );
    expect(delivered).toEqual(["b-item", "b-item-2"]);
    unmount();
  });
});
