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

import { createCollaborationServer } from "@/lib/collaboration/websocket-server";

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

let wss: ReturnType<typeof createCollaborationServer>;
beforeEach(() => {
  wss = createCollaborationServer(new EventEmitter());
});
afterEach(() => wss.close());

const canvasId = "ccanvaspresenceprivacy0001";
const ownerEmail = "owner.secret@example.com";

function connect(user: Record<string, unknown>) {
  const ws = new FakeWs();
  wss.emit("connection", ws, {
    url: `/api/collaboration/${canvasId}`,
    headers: {},
    user,
    clientId: `client-${String(user.userId)}`,
  });
  return ws;
}

async function settle() {
  for (let i = 0; i < 20; i++) await Promise.resolve();
}

describe("presence payloads", () => {
  it("never send a collaborator's email to anyone, guests included", async () => {
    const owner = connect({
      userId: "owner-1",
      email: ownerEmail,
      color: "#111",
      accessLevel: "OWNER",
    });
    const guest = connect({
      userId: "guest:abc",
      email: "",
      name: "Guest",
      color: "#222",
      accessLevel: "VIEW",
    });
    await settle();

    owner.emit(
      "message",
      Buffer.from(
        JSON.stringify({
          type: "message",
          payload: {
            kind: "cursor_chat",
            message: "hello",
            position: { x: 1, y: 2 },
          },
        }),
      ),
      false,
    );
    await settle();

    const received = guest.sent.join("\n");
    expect(received).toContain('"type":"presence"');
    expect(received).toContain("hello");
    expect(received).not.toContain(ownerEmail);
    const presence = guest.sent
      .map((raw) => JSON.parse(raw) as { type: string; users?: unknown[] })
      .filter((m) => m.type === "presence")
      .at(-1)!;
    const ownerEntry = (
      presence.users as Array<{ userId: string; name?: string }>
    ).find((u) => u.userId === "owner-1");
    expect(ownerEntry?.name).toBe("Collaborator");
    owner.close();
    guest.close();
  });
});
