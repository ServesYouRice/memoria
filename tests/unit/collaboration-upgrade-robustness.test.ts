import { EventEmitter } from "events";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  admit: vi.fn(),
  release: vi.fn(async () => undefined),
  consumeUpgrade: vi.fn(async () => true),
  canvasFindUnique: vi.fn(async () => null),
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    canvas: { findUnique: mocks.canvasFindUnique },
    user: { findUnique: vi.fn(async () => null) },
  },
}));
vi.mock("@/lib/auth/session", () => ({
  getSessionFromHeaders: vi.fn(async () => null),
  headersFromNode: () => new Headers(),
}));
vi.mock("@/lib/cache/redis-client", () => ({ getRedisClient: () => null }));
vi.mock("@/lib/collaboration/shared-admission", () => ({
  SharedConnectionAdmission: class {
    totalConnections = 0;
    consumeUpgrade = mocks.consumeUpgrade;
    admit = mocks.admit;
    release = mocks.release;
    renew = vi.fn(async () => undefined);
    sweep = vi.fn();
  },
}));

import { createCollaborationServer } from "@/lib/collaboration/websocket-server";

class FakeSocket {
  write = vi.fn();
  destroy = vi.fn();
}

class FakeWs extends EventEmitter {
  readyState = 1;
  close = vi.fn(() => {
    this.readyState = 3;
  });
  terminate = vi.fn(() => {
    this.readyState = 3;
  });
  ping = vi.fn();
  send = vi.fn();
}

const origin = new URL(process.env.AUTH_URL!).origin;
let wss: ReturnType<typeof createCollaborationServer> | null = null;

beforeEach(() => vi.clearAllMocks());
afterEach(() => {
  wss?.close();
  wss = null;
});

function setup() {
  const server = new EventEmitter();
  wss = createCollaborationServer(server);
  const upgrade = server.listeners("upgrade")[0] as (
    request: unknown,
    socket: unknown,
    head: Buffer,
  ) => Promise<void>;
  return { upgrade };
}

describe("presence upgrade with a malformed Host header", () => {
  it.each(["[", "x:99999", "a b"])(
    "answers and destroys the socket for Host %s without rejecting",
    async (host) => {
      const { upgrade } = setup();
      const socket = new FakeSocket();
      const request = {
        url: "/api/collaboration/ckcanvas000000000000000000",
        headers: { host, origin },
        socket: { remoteAddress: "203.0.113.5" },
      };
      await expect(
        upgrade(request, socket, Buffer.alloc(0)),
      ).resolves.toBeUndefined();
      expect(socket.destroy).toHaveBeenCalledTimes(1);
      expect(socket.write).toHaveBeenCalled();
      // The per-client budget still applies to such requests.
      expect(mocks.consumeUpgrade).toHaveBeenCalledTimes(1);
    },
  );
});

describe("accepted presence socket during asynchronous setup", () => {
  it("handles an 'error' while admission is pending and releases the slot", async () => {
    setup();
    let resolveAdmit!: (value: { admitted: boolean }) => void;
    mocks.admit.mockImplementation(
      () => new Promise((resolve) => (resolveAdmit = resolve)),
    );
    const ws = new FakeWs();
    const request = {
      url: "/api/collaboration/ckcanvas000000000000000000",
      headers: { host: "localhost:3000" },
      user: { userId: "u1", email: "u@example.com", color: "#000" },
      clientId: "client-1",
    };
    wss!.emit("connection", ws, request);
    await vi.waitFor(() => expect(mocks.admit).toHaveBeenCalled());

    expect(() => ws.emit("error", new Error("invalid frame"))).not.toThrow();
    resolveAdmit({ admitted: true });
    await vi.waitFor(() => expect(mocks.release).toHaveBeenCalledTimes(1));
    expect(ws.readyState).toBe(3);
  });

  it("does not parse the Host header", async () => {
    setup();
    mocks.admit.mockResolvedValue({ admitted: false, reason: "canvas" });
    const ws = new FakeWs();
    wss!.emit("connection", ws, {
      url: "/api/collaboration/ckcanvas000000000000000000",
      headers: { host: "[" },
      user: { userId: "u1", email: "u@example.com", color: "#000" },
      clientId: "client-1",
    });
    await vi.waitFor(() => expect(ws.close).toHaveBeenCalled());
    expect(mocks.admit).toHaveBeenCalledWith(
      expect.objectContaining({ canvasId: "ckcanvas000000000000000000" }),
    );
  });
});
