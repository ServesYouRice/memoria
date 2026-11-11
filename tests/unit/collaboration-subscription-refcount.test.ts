import { EventEmitter } from "events";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const redis = vi.hoisted(() => {
  const ops: string[] = [];
  const pending: Array<{ resolve: () => void }> = [];
  const deferred = (op: string) =>
    new Promise<void>((resolve) => {
      ops.push(op);
      pending.push({ resolve });
    });
  const subscriber = {
    on: () => subscriber,
    subscribe: (channel: string) => deferred(`subscribe:${channel}`),
    unsubscribe: (channel: string) => deferred(`unsubscribe:${channel}`),
  };
  const publisher = {
    duplicate: () => subscriber,
    publish: async () => 1,
    on: () => publisher,
  };
  return { ops, pending, publisher };
});

vi.mock("@/lib/db", () => ({ prisma: {} }));
vi.mock("@/lib/auth/session", () => ({
  getSessionFromHeaders: vi.fn(async () => null),
  headersFromNode: () => new Headers(),
}));
vi.mock("@/lib/cache/redis-client", () => ({
  getRedisClient: () => redis.publisher,
}));
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
  getCanvasConnectionCount,
} from "@/lib/collaboration/websocket-server";

class FakeWs extends EventEmitter {
  readyState = 1;
  close = vi.fn(() => {
    this.readyState = 3;
    this.emit("close");
  });
  terminate = vi.fn(() => this.close());
  ping = vi.fn();
  send = vi.fn();
}

let wss: ReturnType<typeof createCollaborationServer>;
let canvasSeq = 0;

beforeEach(() => {
  redis.ops.length = 0;
  redis.pending.length = 0;
  wss = createCollaborationServer(new EventEmitter());
});
afterEach(() => wss.close());

function connect(canvasId: string, userId: string) {
  const ws = new FakeWs();
  wss.emit("connection", ws, {
    url: `/api/collaboration/${canvasId}`,
    headers: {},
    user: { userId, email: `${userId}@example.com`, color: "#000" },
    clientId: `client-${userId}`,
  });
  return ws;
}

async function settle() {
  for (let i = 0; i < 20; i++) await Promise.resolve();
}

async function resolveAll() {
  while (redis.pending.length) {
    redis.pending.shift()!.resolve();
    await settle();
  }
}

function opsFor(canvasId: string) {
  return redis.ops.filter((op) => op.endsWith(canvasId));
}

describe("presence Redis subscription reference count", () => {
  it("subscribes once for two concurrent connections and keeps it when one closes", async () => {
    const canvasId = `ccanvasrefcount${canvasSeq++}`;
    const first = connect(canvasId, "u1");
    const second = connect(canvasId, "u2");
    await settle();
    await resolveAll();
    expect(getCanvasConnectionCount(canvasId)).toBe(2);

    first.close();
    await settle();
    await resolveAll();

    const ops = opsFor(canvasId);
    expect(ops.filter((op) => op.startsWith("subscribe"))).toHaveLength(1);
    expect(ops.filter((op) => op.startsWith("unsubscribe"))).toHaveLength(0);
    second.close();
    await settle();
    await resolveAll();
    expect(opsFor(canvasId).at(-1)).toMatch(/^unsubscribe/);
  });

  it("ends subscribed when a connect lands during the last unsubscribe", async () => {
    const canvasId = `ccanvasrefcount${canvasSeq++}`;
    const first = connect(canvasId, "u1");
    await settle();
    await resolveAll();

    first.close();
    await settle();
    expect(opsFor(canvasId).at(-1)).toMatch(/^unsubscribe/);
    const second = connect(canvasId, "u2");
    await settle();
    await resolveAll();

    expect(opsFor(canvasId).at(-1)).toMatch(/^subscribe/);
    expect(getCanvasConnectionCount(canvasId)).toBe(1);
    second.close();
    await settle();
    await resolveAll();
  });
});
