/**
 * IMP-043: two sync server replicas sharing one PostgreSQL database and one
 * Redis. Clients connect to different replicas and must see each other's
 * edits; row changes are reconciled into the document exactly once; shared
 * connection limits hold across replicas.
 *
 * Needs TEST_DATABASE_URL and a Redis at TEST_REDIS_URL (default
 * redis://127.0.0.1:6379).
 */

import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from "vitest";

// The sync servers get their Redis explicitly; nothing else may share it.
vi.mock("@/lib/cache/redis-client", () => ({ getRedisClient: () => null }));

import Redis from "ioredis";
import WebSocket from "ws";
import * as Y from "yjs";
import { HocuspocusProvider } from "@hocuspocus/provider";
import { prisma } from "@/lib/db";
import { getAuthServer } from "@/lib/auth/server";
import { createCredentialAccount } from "@/lib/auth/credentials";
import { hashPassword } from "@/lib/auth/password";
import { recordCanvasItemEvent } from "@/lib/collaboration/committed-events";
import { lockCanvasForMutation } from "@/lib/canvas/mutation-lock";
import {
  createSyncServer,
  type SyncServer,
} from "@/lib/collaboration/sync/server";
import {
  COLLABORATION_SYNC_PATH,
  createCanvasItemId,
} from "@/lib/collaboration/sync/protocol";
import {
  applyItemState,
  documentItems,
  readAllItemStates,
  readItemState,
} from "@/lib/collaboration/sync/document-items";
import { readPersistedCanvasDocument } from "@/lib/collaboration/sync/store";
import { SharedConnectionAdmission } from "@/lib/collaboration/shared-admission";
import { ItemType } from "@/types/canvas";
import { CookieJar, TEST_ORIGIN, callAuth } from "../helpers/auth-harness";

const REDIS_URL = process.env.TEST_REDIS_URL || "redis://127.0.0.1:6379";
const PASSWORD = "Correct-Horse-Battery-Staple-42!";
const testLogger = {
  info() {},
  warn: (...args: unknown[]) => console.warn("[sync warn]", ...args),
  error: (...args: unknown[]) => console.error("[sync error]", ...args),
};

let counter = 0;
const servers: SyncServer[] = [];
const providers: HocuspocusProvider[] = [];
const redisClients: Redis[] = [];

function redisClient(): Redis {
  const client = new Redis(REDIS_URL, { maxRetriesPerRequest: 1 });
  redisClients.push(client);
  return client;
}

async function createSignedInUser(label: string) {
  counter += 1;
  const email = `replica-${label}-${Date.now()}-${counter}@example.com`;
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

async function startReplica(options: {
  redis: Redis | null;
  reconcileIntervalMs: number;
  compactAfterUpdates?: number;
}): Promise<{ server: SyncServer; url: string }> {
  const server = createSyncServer({
    prisma,
    logger: testLogger,
    port: 0,
    address: "127.0.0.1",
    allowedOrigin: TEST_ORIGIN,
    authorizationRefreshMs: 60_000,
    reconcileIntervalMs: options.reconcileIntervalMs,
    compactAfterUpdates: options.compactAfterUpdates,
    redis: options.redis,
  });
  const { port } = await server.listen();
  servers.push(server);
  return { server, url: `ws://127.0.0.1:${port}${COLLABORATION_SYNC_PATH}` };
}

function connect(url: string, canvasId: string, cookie: string) {
  const headers = { origin: TEST_ORIGIN, cookie };
  class SessionWebSocket extends WebSocket {
    constructor(address: string) {
      super(address, { headers });
    }
  }
  const provider = new HocuspocusProvider({
    url,
    name: canvasId,
    document: new Y.Doc(),
    token: "",
    WebSocketPolyfill: SessionWebSocket,
  });
  providers.push(provider);
  return { provider, doc: provider.document };
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

async function waitForAcknowledged(provider: HocuspocusProvider) {
  await waitFor(() => provider.isSynced && !provider.hasUnsyncedChanges);
}

function noteState(id: string, x: number) {
  return {
    id,
    type: ItemType.NOTE,
    positionX: x,
    positionY: 20,
    width: 200,
    height: 120,
    zIndex: 1,
    tags: [],
    content: {
      formatVersion: 1,
      document: {
        type: "doc",
        content: [
          { type: "paragraph", content: [{ type: "text", text: `note ${x}` }] },
        ],
      },
    },
  };
}

function addNote(doc: Y.Doc, x: number): string {
  const id = createCanvasItemId();
  doc.transact(() => applyItemState(documentItems(doc), id, noteState(id, x)));
  return id;
}

function itemIds(doc: Y.Doc): string[] {
  return Array.from(documentItems(doc).keys()).sort();
}

let owner: Awaited<ReturnType<typeof createSignedInUser>>;
let editor: Awaited<ReturnType<typeof createSignedInUser>>;

beforeAll(async () => {
  owner = await createSignedInUser("owner");
  editor = await createSignedInUser("editor");
});

afterEach(async () => {
  for (const provider of providers.splice(0)) provider.destroy();
  for (const server of servers.splice(0)) await server.destroy();
});

afterAll(async () => {
  for (const client of redisClients.splice(0)) await client.quit();
  await prisma.$disconnect();
});

async function sharedCanvas() {
  const canvas = await prisma.canvas.create({
    data: { name: "Replica canvas", userId: owner.user.id },
  });
  await prisma.canvasShare.create({
    data: {
      canvasId: canvas.id,
      email: editor.user.email,
      recipientId: editor.user.id,
      role: "EDIT",
    },
  });
  return canvas;
}

describe("two sync replicas", () => {
  it("shows each client the other replica's edits through Redis", async () => {
    const canvas = await sharedCanvas();
    // Polling is effectively off: only the Redis announcement can deliver.
    const a = await startReplica({
      redis: redisClient(),
      reconcileIntervalMs: 60_000,
    });
    const b = await startReplica({
      redis: redisClient(),
      reconcileIntervalMs: 60_000,
    });
    const onA = connect(a.url, canvas.id, owner.cookie);
    const onB = connect(b.url, canvas.id, editor.cookie);
    await waitFor(() => onA.provider.isSynced && onB.provider.isSynced);

    const fromA = addNote(onA.doc, 10);
    await waitForAcknowledged(onA.provider);
    await waitFor(() => documentItems(onB.doc).has(fromA));

    const fromB = addNote(onB.doc, 20);
    await waitForAcknowledged(onB.provider);
    await waitFor(() => documentItems(onA.doc).has(fromB));

    // Concurrent edits to one item from both replicas converge.
    (documentItems(onA.doc).get(fromA) as Y.Map<unknown>).set("positionX", 300);
    (documentItems(onB.doc).get(fromA) as Y.Map<unknown>).set("positionY", 400);
    await waitForAcknowledged(onA.provider);
    await waitForAcknowledged(onB.provider);
    for (const doc of [onA.doc, onB.doc]) {
      await waitFor(() => {
        const state = readItemState(fromA, documentItems(doc).get(fromA));
        return state?.positionX === 300 && state?.positionY === 400;
      });
    }

    // The stored document and the projected rows agree with both clients.
    const persisted = await readPersistedCanvasDocument(prisma, canvas.id);
    expect(itemIds(persisted!.doc)).toEqual([fromA, fromB].sort());
    expect(readAllItemStates(persisted!.doc)).toEqual(
      readAllItemStates(onA.doc),
    );
    const rows = await prisma.canvasItem.findMany({
      where: { canvasId: canvas.id, deletedAt: null },
      select: { id: true, positionX: true, positionY: true },
    });
    expect(rows.find((row) => row.id === fromA)).toMatchObject({
      positionX: 300,
      positionY: 400,
    });
    expect(rows).toHaveLength(2);
  });

  it("converges without Redis through the reconcile interval", async () => {
    const canvas = await sharedCanvas();
    const a = await startReplica({ redis: null, reconcileIntervalMs: 50 });
    const b = await startReplica({ redis: null, reconcileIntervalMs: 50 });
    const onA = connect(a.url, canvas.id, owner.cookie);
    const onB = connect(b.url, canvas.id, editor.cookie);
    await waitFor(() => onA.provider.isSynced && onB.provider.isSynced);

    const fromA = addNote(onA.doc, 10);
    const fromB = addNote(onB.doc, 20);
    await waitForAcknowledged(onA.provider);
    await waitForAcknowledged(onB.provider);
    for (const doc of [onA.doc, onB.doc])
      await waitFor(() => itemIds(doc).length === 2);
    expect(itemIds(onA.doc)).toEqual([fromA, fromB].sort());
  });

  it("reconciles a row change into the document exactly once", async () => {
    const canvas = await sharedCanvas();
    const a = await startReplica({
      redis: redisClient(),
      reconcileIntervalMs: 40,
    });
    const b = await startReplica({
      redis: redisClient(),
      reconcileIntervalMs: 40,
    });
    const onA = connect(a.url, canvas.id, owner.cookie);
    const onB = connect(b.url, canvas.id, editor.cookie);
    await waitFor(() => onA.provider.isSynced && onB.provider.isSynced);

    // What every HTTP item route does: lock, write the row, record the event.
    const created = await prisma.$transaction(async (tx) => {
      await lockCanvasForMutation(tx, canvas.id);
      const item = await tx.canvasItem.create({
        data: {
          canvasId: canvas.id,
          type: "SHAPE",
          positionX: 5,
          positionY: 6,
          width: 50,
          height: 60,
          zIndex: 2,
          content: { shapeType: "circle", fill: "#ff0000" },
          tags: [],
          createdById: owner.user.id,
        },
      });
      await recordCanvasItemEvent(tx, {
        canvasId: canvas.id,
        actorId: owner.user.id,
        itemId: item.id,
        version: item.version,
        operation: "created",
      });
      return item;
    });

    for (const doc of [onA.doc, onB.doc])
      await waitFor(() => documentItems(doc).has(created.id));
    // Let both replicas run several more reconcile passes.
    await new Promise((resolve) => setTimeout(resolve, 300));

    const derived = await prisma.canvasDocumentUpdate.count({
      where: { canvasId: canvas.id, actorId: null },
    });
    expect(derived).toBe(1);
    const persisted = await readPersistedCanvasDocument(prisma, canvas.id);
    expect(itemIds(persisted!.doc)).toEqual([created.id]);
  });

  it("keeps a lagging replica correct after another replica compacts", async () => {
    const canvas = await sharedCanvas();
    const a = await startReplica({
      redis: null,
      reconcileIntervalMs: 60_000,
      compactAfterUpdates: 2,
    });
    const b = await startReplica({ redis: null, reconcileIntervalMs: 60_000 });
    const onA = connect(a.url, canvas.id, owner.cookie);
    const onB = connect(b.url, canvas.id, editor.cookie);
    await waitFor(() => onA.provider.isSynced && onB.provider.isSynced);

    // B never hears of these; A compacts them away (deleting update rows).
    const ids = [];
    for (const x of [1, 2, 3, 4, 5]) {
      ids.push(addNote(onA.doc, x));
      await waitForAcknowledged(onA.provider);
    }
    const document = await prisma.canvasDocument.findUniqueOrThrow({
      where: { canvasId: canvas.id },
      select: { compactedThrough: true },
    });
    expect(document.compactedThrough).toBeGreaterThan(BigInt(0));

    // B's next write first applies the compacted state it missed.
    const fromB = addNote(onB.doc, 99);
    await waitForAcknowledged(onB.provider);
    await waitFor(() => itemIds(onB.doc).length === 6);
    expect(itemIds(onB.doc)).toEqual([...ids, fromB].sort());

    await b.server.reconcileOpenDocuments();
    await a.server.reconcileOpenDocuments();
    await waitFor(() => itemIds(onA.doc).length === 6);
    const persisted = await readPersistedCanvasDocument(prisma, canvas.id);
    expect(itemIds(persisted!.doc)).toEqual([...ids, fromB].sort());
  });
});

describe("sync connection limits across replicas (TASK-171)", () => {
  it("counts one principal's document connections on both replicas", async () => {
    const canvas = await sharedCanvas();
    const a = await startReplica({
      redis: redisClient(),
      reconcileIntervalMs: 60_000,
    });
    const b = await startReplica({
      redis: redisClient(),
      reconcileIntervalMs: 60_000,
    });
    const open = Array.from({ length: 10 }, (_value, index) =>
      connect(index % 2 ? a.url : b.url, canvas.id, owner.cookie),
    );
    await waitFor(() => open.every(({ provider }) => provider.isSynced));

    const extra = connect(b.url, canvas.id, owner.cookie);
    const failures: string[] = [];
    extra.provider.on(
      "authenticationFailed",
      ({ reason }: { reason: string }) => failures.push(reason),
    );
    await waitFor(() => failures.includes("memoria:unavailable"));

    // A slot freed on one replica is free on the other.
    open[1]!.provider.destroy();
    extra.provider.destroy();
    await waitFor(async () => {
      const next = connect(b.url, canvas.id, owner.cookie);
      let refused = false;
      next.provider.on("authenticationFailed", () => {
        refused = true;
      });
      try {
        await waitFor(() => next.provider.isSynced || refused);
        return next.provider.isSynced;
      } finally {
        next.provider.destroy();
      }
    });
  });
});

describe("shared connection limits", () => {
  const limits = { global: 100, perCanvas: 3, perPrincipal: 2, perClient: 50 };

  function replica(scope: string, leaseMs = 60_000) {
    return new SharedConnectionAdmission({
      scope,
      limits,
      upgradesPerMinute: 3,
      leaseMs,
      redis: redisClient(),
      logger: testLogger,
    });
  }

  function connection(principalId: string, canvasId = "canvas-1") {
    counter += 1;
    return {
      id: `connection-${counter}`,
      canvasId,
      principalId,
      clientId: `client-${principalId}`,
    };
  }

  it("counts a principal's connections on every replica", async () => {
    const scope = `test-${Date.now()}-principal`;
    const a = replica(scope);
    const b = replica(scope);
    const first = connection("alice");
    expect(await a.admit(first)).toEqual({ admitted: true });
    expect(await b.admit(connection("alice"))).toEqual({ admitted: true });
    expect(await a.admit(connection("alice"))).toEqual({
      admitted: false,
      reason: "principal",
    });
    expect(await b.admit(connection("alice"))).toEqual({
      admitted: false,
      reason: "principal",
    });
    await a.release(first);
    expect(await b.admit(connection("alice"))).toEqual({ admitted: true });
  });

  it("caps a canvas across replicas", async () => {
    const scope = `test-${Date.now()}-canvas`;
    const a = replica(scope);
    const b = replica(scope);
    expect(await a.admit(connection("u1", "busy"))).toEqual({ admitted: true });
    expect(await b.admit(connection("u2", "busy"))).toEqual({ admitted: true });
    expect(await a.admit(connection("u3", "busy"))).toEqual({ admitted: true });
    expect(await b.admit(connection("u4", "busy"))).toEqual({
      admitted: false,
      reason: "canvas",
    });
  });

  it("frees the connections of a replica that stopped renewing", async () => {
    const scope = `test-${Date.now()}-lease`;
    const crashed = replica(scope, 200);
    const survivor = replica(scope, 200);
    expect(await crashed.admit(connection("bob"))).toEqual({ admitted: true });
    expect(await crashed.admit(connection("bob"))).toEqual({ admitted: true });
    expect((await survivor.admit(connection("bob"))).admitted).toBe(false);
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(await survivor.admit(connection("bob"))).toEqual({
      admitted: true,
    });
  });

  it("keeps renewed connections past their first lease", async () => {
    const scope = `test-${Date.now()}-renew`;
    const a = replica(scope, 200);
    const b = replica(scope, 200);
    const held = [connection("carol"), connection("carol")];
    for (const entry of held) await a.admit(entry);
    for (let index = 0; index < 4; index += 1) {
      await new Promise((resolve) => setTimeout(resolve, 100));
      await a.renew(held);
    }
    expect((await b.admit(connection("carol"))).admitted).toBe(false);
  });

  it("shares the upgrade budget", async () => {
    const scope = `test-${Date.now()}-upgrades`;
    const a = replica(scope);
    const b = replica(scope);
    expect(await a.consumeUpgrade("1.2.3.4")).toBe(true);
    expect(await b.consumeUpgrade("1.2.3.4")).toBe(true);
    expect(await a.consumeUpgrade("1.2.3.4")).toBe(true);
    expect(await b.consumeUpgrade("1.2.3.4")).toBe(false);
  });
});
