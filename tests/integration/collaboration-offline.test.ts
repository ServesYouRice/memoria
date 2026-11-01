/**
 * IMP-045: offline edits against the real sync server and PostgreSQL. A
 * browser session keeps its document on the device (IndexedDB, here
 * fake-indexeddb); "offline" sessions point at a port nothing listens on, so
 * they open from the device copy alone, as a reload without a network does.
 */
import "fake-indexeddb/auto";
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from "vitest";

vi.mock("@/lib/cache/redis-client", () => ({ getRedisClient: () => null }));

import WebSocket from "ws";
import * as Y from "yjs";
import { prisma } from "@/lib/db";
import { getAuthServer } from "@/lib/auth/server";
import { createCredentialAccount } from "@/lib/auth/credentials";
import { hashPassword } from "@/lib/auth/password";
import {
  createSyncServer,
  type SyncServer,
} from "@/lib/collaboration/sync/server";
import { COLLABORATION_SYNC_PATH } from "@/lib/collaboration/sync/protocol";
import { CanvasDocumentSession } from "@/lib/collaboration/sync/client-session";
import {
  clearOfflineCache,
  openCanvasDocumentCache,
} from "@/lib/collaboration/sync/offline-store";
import { ItemType } from "@/types/canvas";
import { CookieJar, TEST_ORIGIN, callAuth } from "../helpers/auth-harness";

const PASSWORD = "Correct-Horse-Battery-Staple-42!";
// Nothing listens here: the session never connects.
const OFFLINE_URL = `ws://127.0.0.1:9${COLLABORATION_SYNC_PATH}`;
const testLogger = {
  info() {},
  warn() {},
  error: (...args: unknown[]) => console.error("[sync error]", ...args),
};

let counter = 0;
const servers: SyncServer[] = [];
const sessions: CanvasDocumentSession[] = [];

type SignedInUser = Awaited<ReturnType<typeof createSignedInUser>>;

async function createSignedInUser(label: string) {
  counter += 1;
  const email = `offline-${label}-${Date.now()}-${counter}@example.com`;
  const user = await prisma.user.create({
    data: {
      email,
      name: label,
      emailVerified: true,
      emailVerifiedAt: new Date(),
    },
  });
  await createCredentialAccount(prisma, user.id, await hashPassword(PASSWORD));
  const jar = new CookieJar();
  const signIn = await callAuth(
    getAuthServer().handler,
    jar,
    "/sign-in/email",
    {
      body: { email, password: PASSWORD },
    },
  );
  expect(signIn.status).toBe(200);
  return { user, cookie: jar.header() };
}

async function startServer(): Promise<string> {
  const server = createSyncServer({
    prisma,
    logger: testLogger,
    port: 0,
    address: "127.0.0.1",
    allowedOrigin: TEST_ORIGIN,
    authorizationRefreshMs: 150,
    reconcileIntervalMs: 50,
  });
  const { port } = await server.listen();
  servers.push(server);
  return `ws://127.0.0.1:${port}${COLLABORATION_SYNC_PATH}`;
}

function openSession(input: {
  url: string;
  canvasId: string;
  member: SignedInUser;
  onRejectedChange?: () => void;
}) {
  const headers = { origin: TEST_ORIGIN, cookie: input.member.cookie };
  class SessionWebSocket extends WebSocket {
    constructor(address: string) {
      super(address, { headers });
    }
  }
  const session = new CanvasDocumentSession({
    canvasId: input.canvasId,
    url: input.url,
    WebSocketPolyfill: SessionWebSocket,
    retryDelayMs: 50,
    onRejectedChange: input.onRejectedChange,
    cache: openCanvasDocumentCache(input.member.user.id, input.canvasId),
  });
  sessions.push(session);
  return session;
}

/** Close a session the way a reload does, once its device copy is written. */
async function reload(session: CanvasDocumentSession) {
  await session.whenCached();
  session.destroy();
}

async function waitFor(
  check: () => boolean | Promise<boolean>,
  timeoutMs = 5_000,
) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (await check()) return;
    if (Date.now() > deadline)
      throw new Error("Timed out waiting for condition");
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

async function waitForStored(session: CanvasDocumentSession) {
  await waitFor(() => {
    const snapshot = session.getSnapshot();
    return (
      snapshot.connected &&
      !snapshot.restored &&
      snapshot.pendingChanges === 0 &&
      snapshot.unsavedChanges === 0
    );
  });
}

function noteInput(canvasId: string, text: string, positionX = 10) {
  return {
    canvasId,
    type: ItemType.NOTE,
    positionX,
    positionY: 20,
    width: 200,
    height: 120,
    zIndex: 1,
    tags: [],
    content: {
      formatVersion: 1,
      document: {
        type: "doc",
        content: [{ type: "paragraph", content: [{ type: "text", text }] }],
      },
    },
  };
}

async function createCanvas(ownerId: string) {
  return prisma.canvas.create({
    data: { name: "Offline canvas", userId: ownerId },
  });
}

/** A first visit online, leaving a writable device copy. */
async function visitOnline(
  url: string,
  canvasId: string,
  member: SignedInUser,
) {
  const session = openSession({ url, canvasId, member });
  await waitFor(() => session.acceptsWrites);
  const note = session.createItem(noteInput(canvasId, "Online"));
  await waitForStored(session);
  await reload(session);
  return note;
}

/** A reload without a network: the canvas opens from the device copy. */
async function openOffline(canvasId: string, member: SignedInUser) {
  const session = openSession({ url: OFFLINE_URL, canvasId, member });
  await waitFor(() => session.getSnapshot().restored);
  expect(session.getSnapshot().connected).toBe(false);
  return session;
}

let owner: SignedInUser;

beforeAll(async () => {
  owner = await createSignedInUser("owner");
});

afterEach(async () => {
  for (const session of sessions.splice(0)) session.destroy();
  for (const server of servers.splice(0)) await server.destroy();
  await clearOfflineCache();
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("offline canvas edits", () => {
  it("keeps edits made offline across a reload and stores them on reconnect", async () => {
    const canvas = await createCanvas(owner.user.id);
    const url = await startServer();
    const online = await visitOnline(url, canvas.id, owner);

    const offline = await openOffline(canvas.id, owner);
    expect(offline.acceptsWrites).toBe(true);
    const created = offline.createItem(noteInput(canvas.id, "Offline", 400));
    offline.updateItem(online.id, { positionX: 300 });
    expect(offline.getSnapshot().unsavedChanges).toBe(2);
    await reload(offline);

    // Another reload, still offline: the edits and their count are there.
    const again = await openOffline(canvas.id, owner);
    expect(again.getSnapshot().unsavedChanges).toBe(2);
    expect(again.hasItem(created.id)).toBe(true);
    await reload(again);

    expect(
      await prisma.canvasItem.findUnique({ where: { id: created.id } }),
    ).toBeNull();

    const reconnected = openSession({
      url,
      canvasId: canvas.id,
      member: owner,
    });
    await waitFor(() => reconnected.getSnapshot().restored);
    await waitForStored(reconnected);

    const rows = await prisma.canvasItem.findMany({
      where: { canvasId: canvas.id, deletedAt: null },
      orderBy: { positionX: "asc" },
      select: { id: true, positionX: true },
    });
    expect(rows).toEqual([
      { id: online.id, positionX: 300 },
      { id: created.id, positionX: 400 },
    ]);
  });

  it("discards an offline change the server refuses and never sends it again", async () => {
    const canvas = await createCanvas(owner.user.id);
    const url = await startServer();
    const note = await visitOnline(url, canvas.id, owner);

    const offline = await openOffline(canvas.id, owner);
    // Markup the note schema does not allow, written past the editor.
    const fragment = offline.noteFragment(note.id)!;
    fragment.doc!.transact(() =>
      fragment.insert(0, [new Y.XmlElement("script")]),
    );
    await reload(offline);

    let rejected = 0;
    const reconnected = openSession({
      url,
      canvasId: canvas.id,
      member: owner,
      onRejectedChange: () => {
        rejected += 1;
      },
    });
    await waitFor(() => rejected === 1);
    await waitFor(() => reconnected.acceptsWrites);
    expect(reconnected.getSnapshot().restored).toBe(false);
    expect(reconnected.noteFragment(note.id)!.toString()).not.toContain(
      "script",
    );
    await reload(reconnected);

    // The device copy now holds the server's document, not the refused one.
    const later = await openOffline(canvas.id, owner);
    expect(later.getSnapshot().unsavedChanges).toBe(0);
    expect(later.noteFragment(note.id)!.toString()).not.toContain("script");
    await reload(later);

    // Reconnecting again sends nothing the server refuses.
    let refusedAgain = 0;
    const settled = openSession({
      url,
      canvasId: canvas.id,
      member: owner,
      onRejectedChange: () => {
        refusedAgain += 1;
      },
    });
    await waitForStored(settled);
    expect(refusedAgain).toBe(0);
  });

  it("discards the device copy of an editor whose access was revoked", async () => {
    const editor = await createSignedInUser("editor");
    const canvas = await createCanvas(owner.user.id);
    const grant = await prisma.canvasShare.create({
      data: {
        canvasId: canvas.id,
        email: editor.user.email,
        recipientId: editor.user.id,
        role: "EDIT",
      },
    });
    const url = await startServer();
    await visitOnline(url, canvas.id, editor);

    const offline = await openOffline(canvas.id, editor);
    const created = offline.createItem(noteInput(canvas.id, "Too late", 500));
    await reload(offline);

    await prisma.canvasShare.delete({ where: { id: grant.id } });
    const reconnected = openSession({
      url,
      canvasId: canvas.id,
      member: editor,
    });
    await waitFor(() => reconnected.getSnapshot().forbidden);
    await reload(reconnected);

    expect(
      await prisma.canvasItem.findUnique({ where: { id: created.id } }),
    ).toBeNull();
    const cached = await openCanvasDocumentCache(
      editor.user.id,
      canvas.id,
    )!.load();
    expect(cached).toBeNull();
  });
});
