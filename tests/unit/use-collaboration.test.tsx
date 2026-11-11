// @vitest-environment happy-dom

import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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

  serverClose(code: number): void {
    if (this.readyState === MockWebSocket.CLOSED) return;
    this.readyState = MockWebSocket.CLOSED;
    this.onclose?.({ code } as CloseEvent);
  }

  receive(value: unknown): void {
    this.onmessage?.({ data: JSON.stringify(value) } as MessageEvent);
  }

  close(code = 1000): void {
    this.serverClose(code);
  }
}

const options = {
  canvasId: "cjld2cjxh0000qzrmn831i7rn",
  userId: "user-1",
  email: "user@example.com",
  name: "Alice",
};

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-08-26T12:00:00.000Z"));
  MockWebSocket.instances = [];
  vi.stubGlobal("WebSocket", MockWebSocket);
  vi.stubGlobal(
    "fetch",
    vi
      .fn()
      .mockResolvedValue(
        new Response(
          JSON.stringify({ events: [], nextCursor: "0", hasMore: false }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
      ),
  );
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("useCollaboration transport behavior", () => {
  it("coalesces pointer movement while chat keeps its own immediate path", async () => {
    const { result, unmount } = renderHook(() => useCollaboration(options));
    const socket = MockWebSocket.instances[0]!;
    await act(async () => {
      socket.open();
      await Promise.resolve();
    });

    act(() => {
      for (let index = 0; index < 100; index += 1) {
        result.current.updateCursor(index, index + 1);
      }
      result.current.broadcastMessage({
        kind: "cursor_chat",
        message: "Still live",
        position: { x: 10, y: 20 },
      });
    });

    expect(socket.send).toHaveBeenCalledTimes(1);
    expect(JSON.parse(socket.send.mock.calls[0]![0])).toMatchObject({
      type: "message",
      payload: { kind: "cursor_chat", message: "Still live" },
    });

    act(() => vi.advanceTimersByTime(49));
    expect(socket.send).toHaveBeenCalledTimes(1);
    act(() => vi.advanceTimersByTime(1));
    expect(socket.send).toHaveBeenCalledTimes(2);
    expect(JSON.parse(socket.send.mock.calls[1]![0])).toEqual({
      type: "cursor",
      position: { x: 99, y: 100 },
    });
    unmount();
  });

  it("keeps cursor and social traffic live through a sustained minute", async () => {
    const { result, unmount } = renderHook(() => useCollaboration(options));
    const socket = MockWebSocket.instances[0]!;
    await act(async () => {
      socket.open();
      await Promise.resolve();
    });

    act(() => {
      for (let elapsed = 0; elapsed < 60_100; elapsed += 10) {
        result.current.updateCursor(elapsed, elapsed + 1);
        if (elapsed % 10_000 === 0) {
          result.current.broadcastMessage({
            kind: "reaction",
            emoji: "ok",
            position: { x: elapsed, y: elapsed },
          });
        }
        vi.advanceTimersByTime(10);
      }
    });

    const sent = socket.send.mock.calls.map(([frame]) => JSON.parse(frame));
    const cursorFrames = sent.filter((frame) => frame.type === "cursor");
    const socialFrames = sent.filter((frame) => frame.type === "message");
    expect(cursorFrames.length).toBeGreaterThanOrEqual(1_200);
    expect(cursorFrames.length).toBeLessThanOrEqual(1_202);
    expect(socialFrames).toHaveLength(7);
    expect(result.current.status).toBe("connected");
    unmount();
  });

  it("does not retry a policy revocation and exposes an access message", async () => {
    const { result, unmount } = renderHook(() => useCollaboration(options));
    const socket = MockWebSocket.instances[0]!;
    await act(async () => {
      socket.open();
      await Promise.resolve();
      socket.serverClose(1008);
    });

    expect(result.current.status).toBe("error");
    expect(result.current.connectionMessage).toMatch(/access was revoked/i);
    act(() => vi.advanceTimersByTime(120_000));
    expect(MockWebSocket.instances).toHaveLength(1);
    unmount();
  });

  it("treats a failed upgrade as terminal", () => {
    const { result, unmount } = renderHook(() => useCollaboration(options));
    act(() => MockWebSocket.instances[0]!.serverClose(1006));

    expect(result.current.connectionMessage).toMatch(
      /could not be established/i,
    );
    act(() => vi.advanceTimersByTime(120_000));
    expect(MockWebSocket.instances).toHaveLength(1);
    unmount();
  });

  it("retries an opened transient connection with bounded jitter", async () => {
    vi.spyOn(Math, "random").mockReturnValue(0);
    const { result, unmount } = renderHook(() => useCollaboration(options));
    const socket = MockWebSocket.instances[0]!;
    await act(async () => {
      socket.open();
      await Promise.resolve();
      socket.serverClose(1011);
    });

    expect(result.current.status).toBe("reconnecting");
    act(() => vi.advanceTimersByTime(999));
    expect(MockWebSocket.instances).toHaveLength(1);
    act(() => vi.advanceTimersByTime(1));
    expect(MockWebSocket.instances).toHaveLength(2);
    unmount();
  });

  it("retries failed reconnect handshakes of a session that opened, then recovers online (TASK-186)", async () => {
    vi.spyOn(Math, "random").mockReturnValue(0);
    const { result, unmount } = renderHook(() => useCollaboration(options));
    await act(async () => {
      MockWebSocket.instances[0]!.open();
      await Promise.resolve();
      MockWebSocket.instances[0]!.serverClose(1011);
    });

    // Every reconnect is answered by a 502 from the upgrade proxy: the
    // socket closes without opening.
    for (let attempt = 1; attempt <= 8; attempt += 1) {
      expect(result.current.status).toBe("reconnecting");
      expect(result.current.connectionMessage ?? "").not.toMatch(
        /access could not be established/i,
      );
      const delay = Math.min(15_000, 1_000 * 2 ** (attempt - 1));
      act(() => vi.advanceTimersByTime(delay));
      expect(MockWebSocket.instances).toHaveLength(attempt + 1);
      act(() => MockWebSocket.instances[attempt]!.serverClose(1006));
    }

    expect(result.current.status).toBe("error");
    expect(result.current.connectionMessage).toMatch(/could not reconnect/i);
    act(() => vi.advanceTimersByTime(120_000));
    expect(MockWebSocket.instances).toHaveLength(9);

    act(() => {
      window.dispatchEvent(new Event("online"));
    });
    expect(MockWebSocket.instances).toHaveLength(10);
    await act(async () => {
      MockWebSocket.instances[9]!.open();
      await Promise.resolve();
    });
    expect(result.current.status).toBe("connected");
    unmount();
  });

  it("coalesces a committed-event burst into one consumer batch", () => {
    const onCommittedEvents = vi.fn();
    const { unmount } = renderHook(() =>
      useCollaboration({ ...options, onCommittedEvents }),
    );
    const socket = MockWebSocket.instances[0]!;

    act(() => {
      for (let index = 0; index < 50; index += 1) {
        socket.receive({
          type: "committed-event",
          event: {
            schemaVersion: 1,
            cursor: String(index + 1),
            operation: "updated",
            entity: {
              type: "canvas-item",
              id: `item-${index}`,
              version: 2,
            },
          },
        });
      }
    });
    expect(onCommittedEvents).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(40));
    expect(onCommittedEvents).toHaveBeenCalledTimes(1);
    expect(onCommittedEvents.mock.calls[0]![0]).toHaveLength(50);
    unmount();
  });

  it("continues after a restore instead of replaying it again (TASK-172)", async () => {
    const onCommittedEvents = vi.fn();
    const onSnapshotRequired = vi.fn();
    const fetchMock = vi.fn().mockImplementation(
      async () =>
        new Response(
          JSON.stringify({
            events: [],
            nextCursor: "11",
            hasMore: true,
            snapshotRequired: true,
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
    );
    vi.stubGlobal("fetch", fetchMock);
    const { unmount } = renderHook(() =>
      useCollaboration({ ...options, onCommittedEvents, onSnapshotRequired }),
    );
    const socket = MockWebSocket.instances[0]!;
    const event = (cursor: number) => ({
      type: "committed-event",
      event: {
        schemaVersion: 1,
        cursor: String(cursor),
        operation: "updated",
        entity: { type: "canvas-item", id: `item-${cursor}`, version: 2 },
      },
    });

    // Live events up to 9, then the restore (sequence 11) is announced.
    act(() => {
      for (let cursor = 1; cursor <= 9; cursor += 1)
        socket.receive(event(cursor));
    });
    act(() => {
      socket.receive({
        type: "message",
        payload: {
          type: "canvas-restore-required",
          restoreRevision: 2,
          cursor: "11",
        },
      });
    });
    expect(onSnapshotRequired).toHaveBeenCalledTimes(1);
    // The next item event follows the restore: no gap, no replay.
    act(() => socket.receive(event(12)));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(100);
    });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(onCommittedEvents.mock.calls.flat(2).map((e) => e.cursor)).toContain(
      "12",
    );

    // A gap whose replay hits a restore at 20: one replay, then the cursor
    // is past it and the deferred event 21 follows without another replay.
    fetchMock.mockImplementation(
      async () =>
        new Response(
          JSON.stringify({
            events: [],
            nextCursor: "20",
            hasMore: true,
            snapshotRequired: true,
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
    );
    act(() => socket.receive(event(21)));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(100);
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(onSnapshotRequired).toHaveBeenCalledTimes(2);
    act(() => socket.receive(event(22)));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(100);
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(onCommittedEvents.mock.calls.flat(2).map((e) => e.cursor)).toEqual(
      expect.arrayContaining(["21", "22"]),
    );
    unmount();
  });
});
