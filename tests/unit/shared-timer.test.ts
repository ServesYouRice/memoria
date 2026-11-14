/**
 * IMP-105: one timer per canvas that everyone on it sees. The server holds
 * the end time, only editors control it, a late joiner gets it at once, and
 * it ends when the last person leaves.
 */
import { EventEmitter } from "events";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  applySharedTimerCommand,
  formatSharedTimer,
  isNewerSharedTimer,
  sharedTimerRemainingMs,
  type SharedTimerState,
} from "@/lib/collaboration/shared-timer";

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

import { createCollaborationServer } from "@/lib/collaboration/websocket-server";

const MIN = 60_000;

describe("shared timer maths", () => {
  it("starts, pauses, resumes and resets from an end time", () => {
    const started = applySharedTimerCommand(
      null,
      { action: "start", durationMs: 15 * MIN },
      1_000,
    );
    expect(started).toMatchObject({
      status: "running",
      endsAt: 1_000 + 15 * MIN,
    });
    expect(sharedTimerRemainingMs(started, 1_000 + 5 * MIN)).toBe(10 * MIN);

    // A second start while running changes nothing.
    expect(
      applySharedTimerCommand(
        started,
        { action: "start", durationMs: MIN },
        2_000,
      ),
    ).toBe(started);

    const paused = applySharedTimerCommand(
      started,
      { action: "pause", durationMs: 15 * MIN },
      1_000 + 5 * MIN,
    );
    expect(paused).toMatchObject({ status: "paused", remainingMs: 10 * MIN });
    // Time passing does not move a paused timer.
    expect(sharedTimerRemainingMs(paused, 9e12)).toBe(10 * MIN);

    const resumed = applySharedTimerCommand(
      paused,
      { action: "start", durationMs: 15 * MIN },
      100 * MIN,
    );
    expect(resumed).toMatchObject({ status: "running", endsAt: 110 * MIN });

    const reset = applySharedTimerCommand(
      resumed,
      { action: "reset", durationMs: 5 * MIN },
      101 * MIN,
    );
    expect(reset).toEqual({
      status: "idle",
      durationMs: 5 * MIN,
      updatedAt: 101 * MIN,
    });
  });

  it("never counts below zero and starts afresh after time is up", () => {
    const state: SharedTimerState = {
      status: "running",
      durationMs: MIN,
      endsAt: 10,
      updatedAt: 0,
    };
    expect(sharedTimerRemainingMs(state, 99)).toBe(0);
    expect(
      applySharedTimerCommand(
        state,
        { action: "start", durationMs: 2 * MIN },
        100,
      ),
    ).toMatchObject({ status: "running", endsAt: 100 + 2 * MIN });
  });

  it("keeps the newest state from another server and formats the time", () => {
    const old: SharedTimerState = {
      status: "idle",
      durationMs: MIN,
      updatedAt: 5,
    };
    expect(isNewerSharedTimer(old, { ...old, updatedAt: 6 })).toBe(true);
    expect(isNewerSharedTimer(old, { ...old, updatedAt: 4 })).toBe(false);
    expect(formatSharedTimer(15 * MIN)).toBe("15:00");
    expect(formatSharedTimer(59_001)).toBe("01:00");
    expect(formatSharedTimer(61 * MIN)).toBe("1:01:00");
  });
});

class FakeWs extends EventEmitter {
  readyState = 1;
  sent: string[] = [];
  close = vi.fn(() => {
    this.readyState = 3;
    this.emit("close");
  });
  terminate = vi.fn(() => this.close());
  ping = vi.fn();
  send = vi.fn((data: string) => {
    this.sent.push(String(data));
  });
}

type TimerFrame = {
  type: "timer";
  timer: SharedTimerState | null;
  serverNow: number;
};

function lastTimer(ws: FakeWs): TimerFrame | undefined {
  return ws.sent
    .map((raw) => JSON.parse(raw) as { type: string })
    .filter((frame): frame is TimerFrame => frame.type === "timer")
    .at(-1);
}

let wss: ReturnType<typeof createCollaborationServer>;
beforeEach(() => {
  wss = createCollaborationServer(new EventEmitter());
});
afterEach(() => wss.close());

let counter = 0;
function connect(canvasId: string, accessLevel: string) {
  counter += 1;
  const ws = new FakeWs();
  wss.emit("connection", ws, {
    url: `/api/collaboration/${canvasId}`,
    headers: {},
    user: {
      userId: `user-${counter}`,
      email: "",
      name: `Person ${counter}`,
      color: "#123",
      accessLevel,
    },
    clientId: `client-${counter}`,
  });
  return ws;
}

function send(ws: FakeWs, action: string, durationMs = 15 * MIN) {
  ws.emit(
    "message",
    Buffer.from(JSON.stringify({ type: "timer", action, durationMs })),
    false,
  );
}

async function settle() {
  for (let i = 0; i < 20; i++) await Promise.resolve();
}

describe("shared timer on the live connection", () => {
  it("shows an editor's start and pause to everyone, with the end time", async () => {
    const canvasId = "ctimershared000000000001";
    const editor = connect(canvasId, "EDIT");
    const viewer = connect(canvasId, "VIEW");
    await settle();
    expect(lastTimer(viewer)?.timer).toBeNull();

    const before = Date.now();
    send(editor, "start", 10 * MIN);
    await settle();
    const seen = lastTimer(viewer)!;
    expect(seen.timer?.status).toBe("running");
    const endsAt = (seen.timer as { endsAt: number }).endsAt;
    expect(endsAt).toBeGreaterThanOrEqual(before + 10 * MIN);
    expect(endsAt).toBeLessThanOrEqual(Date.now() + 10 * MIN);
    expect(typeof seen.serverNow).toBe("number");

    send(editor, "pause");
    await settle();
    expect(lastTimer(viewer)?.timer?.status).toBe("paused");
    editor.close();
    viewer.close();
  });

  it("lets viewers and commenters watch but not control it", async () => {
    const canvasId = "ctimershared000000000002";
    const viewer = connect(canvasId, "VIEW");
    const commenter = connect(canvasId, "COMMENT");
    await settle();
    send(viewer, "start");
    send(commenter, "start");
    await settle();
    expect(lastTimer(viewer)?.timer).toBeNull();
    expect(lastTimer(commenter)?.timer).toBeNull();
    // Refused quietly: the connection stays open.
    expect(viewer.close).not.toHaveBeenCalled();
    viewer.close();
    commenter.close();
  });

  it("gives a late joiner the running timer at once", async () => {
    const canvasId = "ctimershared000000000003";
    const owner = connect(canvasId, "OWNER");
    await settle();
    send(owner, "start", 5 * MIN);
    await settle();
    const late = connect(canvasId, "VIEW");
    await settle();
    expect(lastTimer(late)?.timer).toMatchObject({
      status: "running",
      durationMs: 5 * MIN,
    });
    owner.close();
    late.close();
  });

  it("ends when the last person leaves", async () => {
    const canvasId = "ctimershared000000000004";
    const owner = connect(canvasId, "OWNER");
    await settle();
    send(owner, "start");
    await settle();
    owner.close();
    await settle();
    const next = connect(canvasId, "OWNER");
    await settle();
    expect(lastTimer(next)?.timer).toBeNull();
    next.close();
  });
});
