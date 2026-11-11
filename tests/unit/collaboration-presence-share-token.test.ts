/**
 * TASK-165: the presence socket lets a signed-in user who is neither owner
 * nor recipient onto a public canvas only with its current share token, and
 * the authorization refresh closes them once the link rotates.
 */
import { EventEmitter } from "events";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const canvasId = "ckcanvaspresencetoken00001";
const state = vi.hoisted(() => ({ shareToken: "current" as string | null }));

vi.mock("@/lib/db", () => ({
  prisma: {
    canvas: {
      findUnique: vi.fn(async () => ({
        id: "ckcanvaspresencetoken00001",
        userId: "owner",
        isPublic: true,
        shareToken: state.shareToken,
        shares: [],
      })),
      findMany: vi.fn(async () => [
        {
          id: "ckcanvaspresencetoken00001",
          userId: "owner",
          isPublic: true,
          shareToken: state.shareToken,
          shares: [],
        },
      ]),
    },
    user: {
      findUnique: vi.fn(async () => ({
        id: "stranger",
        email: "s@example.com",
        name: "S",
      })),
    },
    session: {
      findMany: vi.fn(async () => [{ id: "sess-1", userId: "stranger" }]),
    },
  },
}));
vi.mock("@/lib/auth/session", () => ({
  getSessionFromHeaders: vi.fn(async () => ({
    user: { id: "stranger" },
    session: { id: "sess-1" },
  })),
  headersFromNode: () => new Headers(),
}));
vi.mock("@/lib/cache/redis-client", () => ({ getRedisClient: () => null }));
vi.mock("@/lib/collaboration/shared-admission", () => ({
  SharedConnectionAdmission: class {
    totalConnections = 1;
    consumeUpgrade = async () => true;
    admit = async () => ({ admitted: true });
    release = async () => undefined;
    renew = async () => undefined;
    sweep = () => undefined;
  },
}));

import { createCollaborationServer } from "@/lib/collaboration/websocket-server";

const origin = new URL(process.env.AUTH_URL!).origin;

class FakeSocket {
  write = vi.fn();
  destroy = vi.fn();
}

class FakeWs extends EventEmitter {
  readyState = 1;
  bufferedAmount = 0;
  close = vi.fn(() => {
    this.readyState = 3;
    this.emit("close");
  });
  terminate = vi.fn(() => this.close());
  ping = vi.fn(() => this.emit("pong"));
  send = vi.fn();
}

let wss: ReturnType<typeof createCollaborationServer>;
let upgrade: (request: unknown, socket: unknown, head: Buffer) => Promise<void>;
let accepted: unknown[];

beforeEach(() => {
  vi.useFakeTimers();
  state.shareToken = "current";
  const server = new EventEmitter();
  wss = createCollaborationServer(server);
  upgrade = server.listeners("upgrade")[0] as typeof upgrade;
  accepted = [];
  vi.spyOn(wss, "handleUpgrade").mockImplementation(((request: unknown) => {
    accepted.push(request);
  }) as never);
});
afterEach(() => {
  wss.close();
  vi.useRealTimers();
});

function request(query = "") {
  return {
    url: `/api/collaboration/${canvasId}${query}`,
    headers: { host: "localhost:3000", origin },
    socket: { remoteAddress: "203.0.113.5" },
  };
}

describe("presence upgrade for a signed-in non-recipient", () => {
  it("is refused on a public canvas without the share token", async () => {
    const socket = new FakeSocket();
    await upgrade(request(), socket, Buffer.alloc(0));
    expect(accepted).toHaveLength(0);
    expect(String(socket.write.mock.calls[0]?.[0])).toContain("403");
  });

  it("is refused with a stale share token", async () => {
    const socket = new FakeSocket();
    await upgrade(request("?shareToken=old"), socket, Buffer.alloc(0));
    expect(accepted).toHaveLength(0);
  });

  it("gets VIEW with the current token and is closed once it rotates", async () => {
    await upgrade(
      request("?shareToken=current"),
      new FakeSocket(),
      Buffer.alloc(0),
    );
    expect(accepted).toHaveLength(1);
    const accept = accepted[0] as { user: { accessLevel: string } };
    expect(accept.user.accessLevel).toBe("VIEW");

    const ws = new FakeWs();
    wss.emit("connection", ws, accept);
    await vi.advanceTimersByTimeAsync(0);

    state.shareToken = "rotated";
    await vi.advanceTimersByTimeAsync(5 * 60_000);
    expect(ws.close).toHaveBeenCalledWith(
      1008,
      "Session or canvas access was revoked",
    );
  });
});
