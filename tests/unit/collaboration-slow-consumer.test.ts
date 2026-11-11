/**
 * TASK-182: broadcasts bound a slow client's outbound queue. Ephemeral
 * fanout is skipped above the soft limit, a client above the hard limit is
 * closed, and the heartbeat closes one that stays over the hard limit even
 * while it answers pings.
 */
import { EventEmitter } from "events";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({ prisma: {} }));
vi.mock("@/lib/auth/session", () => ({
  getSessionFromHeaders: vi.fn(async () => null),
  headersFromNode: () => new Headers(),
}));
vi.mock("@/lib/cache/redis-client", () => ({ getRedisClient: () => null }));
vi.mock("@/lib/collaboration/shared-admission", () => ({
  SharedConnectionAdmission: class {
    totalConnections = 0;
    consumeUpgrade = async () => true;
    admit = async () => ({ admitted: true });
    release = async () => undefined;
    renew = async () => undefined;
    sweep = () => undefined;
  },
}));

import {
  createCollaborationServer,
  sendToClient,
} from "@/lib/collaboration/websocket-server";

const MiB = 1024 * 1024;

class FakeWs extends EventEmitter {
  readyState = 1;
  bufferedAmount = 0;
  sent: string[] = [];
  close = vi.fn(() => {
    this.readyState = 3;
    this.emit("close");
  });
  terminate = vi.fn(() => this.close());
  // Answers every ping at once, as a client that never reads can.
  ping = vi.fn(() => this.emit("pong"));
  send = vi.fn((data: string) => {
    this.sent.push(String(data));
  });
}

let wss: ReturnType<typeof createCollaborationServer>;
beforeEach(() => {
  vi.useFakeTimers();
  wss = createCollaborationServer(new EventEmitter());
});
afterEach(() => {
  wss.close();
  vi.useRealTimers();
});

const canvasId = "ccanvasslowconsumer000001";

function connect(userId: string) {
  const ws = new FakeWs();
  wss.emit("connection", ws, {
    url: `/api/collaboration/${canvasId}`,
    headers: {},
    user: {
      userId,
      email: "",
      name: userId,
      color: "#111",
      accessLevel: "OWNER",
    },
    clientId: `client-${userId}`,
  });
  return ws;
}

async function settle() {
  for (let i = 0; i < 20; i++) await Promise.resolve();
}

function chat(ws: FakeWs, text: string) {
  ws.emit(
    "message",
    Buffer.from(
      JSON.stringify({
        type: "message",
        payload: {
          kind: "cursor_chat",
          message: text,
          position: { x: 1, y: 2 },
        },
      }),
    ),
    false,
  );
}

describe("slow consumers", () => {
  it("skips ephemeral fanout for a client over the soft limit", async () => {
    const sender = connect("sender");
    const healthy = connect("healthy");
    const slow = connect("slow");
    await settle();
    slow.bufferedAmount = 2 * MiB;
    const before = slow.sent.length;

    chat(sender, "hello");
    await settle();

    expect(healthy.sent.join("\n")).toContain("hello");
    expect(slow.sent.length).toBe(before);
    expect(slow.terminate).not.toHaveBeenCalled();
  });

  it("closes a client over the hard limit instead of queueing more", async () => {
    const sender = connect("sender");
    const slow = connect("slow");
    await settle();
    slow.bufferedAmount = 16 * MiB;
    const before = slow.sent.length;

    chat(sender, "hello");
    await settle();

    expect(slow.sent.length).toBe(before);
    expect(slow.terminate).toHaveBeenCalled();
  });

  it("closes a client that answers pings but stays over the hard limit", async () => {
    const slow = connect("slow");
    await settle();
    slow.bufferedAmount = 16 * MiB;

    await vi.advanceTimersByTimeAsync(5 * 60_000);

    expect(slow.terminate).toHaveBeenCalled();
  });

  it("keeps a healthy pinging client connected", async () => {
    const healthy = connect("healthy");
    await settle();
    await vi.advanceTimersByTimeAsync(5 * 60_000);
    expect(healthy.ping).toHaveBeenCalled();
    expect(healthy.terminate).not.toHaveBeenCalled();
  });

  it("never skips a message that must arrive", () => {
    const limits = { softBytes: 10, hardBytes: 100 };
    const ws = new FakeWs();
    ws.bufferedAmount = 50;
    expect(
      sendToClient({ ws: ws as never }, "event", { droppable: false }, limits),
    ).toBe("sent");
    expect(
      sendToClient({ ws: ws as never }, "cursor", { droppable: true }, limits),
    ).toBe("skipped");
    ws.bufferedAmount = 0;
    expect(
      sendToClient({ ws: ws as never }, "cursor", { droppable: true }, limits),
    ).toBe("sent");
    ws.bufferedAmount = 101;
    expect(
      sendToClient({ ws: ws as never }, "event", { droppable: false }, limits),
    ).toBe("closed");
    expect(ws.sent).toEqual(["event", "cursor"]);
  });
});
