/**
 * IMP-042: the Hocuspocus sync server against real PostgreSQL. Clients are
 * real HocuspocusProviders over WebSockets carrying Better Auth session
 * cookies, exactly as browsers connect.
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

import type * as AuthModule from "@/lib/api/auth";

const routeAuth = vi.hoisted(() => ({ userId: "" }));

vi.mock("@/lib/cache/redis-client", () => ({ getRedisClient: () => null }));
// Version routes authorize with the real `requireCanvasAccess` (IMP-046); only
// the session lookup is replaced.
vi.mock("@/lib/api/auth", async (importOriginal) => ({
  ...(await importOriginal<typeof AuthModule>()),
  requireAuth: async () => ({ userId: routeAuth.userId, email: "" }),
}));

import { NextRequest } from "next/server";
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
  SYNC_CLOSE_REASONS,
  createCanvasItemId,
} from "@/lib/collaboration/sync/protocol";
import {
  applyItemState,
  documentItems,
  readAllItemStates,
  readItemState,
} from "@/lib/collaboration/sync/document-items";
import { readPersistedCanvasDocument } from "@/lib/collaboration/sync/store";
import { writeNoteFragment } from "@/lib/collaboration/sync/note-fragment";
import { CanvasDocumentSession } from "@/lib/collaboration/sync/client-session";
import { ItemType } from "@/types/canvas";
import { POST as createVersion } from "@/app/api/v1/canvases/[canvasId]/versions/route";
import { POST as restoreVersion } from "@/app/api/v1/canvases/[canvasId]/versions/[versionId]/restore/route";
import { CookieJar, TEST_ORIGIN, callAuth } from "../helpers/auth-harness";

const PASSWORD = "Correct-Horse-Battery-Staple-42!";
const testLogger = {
  info() {},
  warn: (...args: unknown[]) => console.warn("[sync warn]", ...args),
  error: (...args: unknown[]) => console.error("[sync error]", ...args),
};

let counter = 0;
const servers: SyncServer[] = [];
const providers: HocuspocusProvider[] = [];
const sessions: CanvasDocumentSession[] = [];

async function createSignedInUser(label: string) {
  counter += 1;
  const email = `sync-${label}-${Date.now()}-${counter}@example.com`;
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

async function startServer(): Promise<{ server: SyncServer; url: string }> {
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
  return { server, url: `ws://127.0.0.1:${port}${COLLABORATION_SYNC_PATH}` };
}

function connect(input: {
  url: string;
  canvasId: string;
  cookie?: string;
  token?: string;
  doc?: Y.Doc;
}) {
  const headers: Record<string, string> = { origin: TEST_ORIGIN };
  if (input.cookie) headers.cookie = input.cookie;
  class SessionWebSocket extends WebSocket {
    constructor(address: string) {
      super(address, { headers });
    }
  }
  const closeReasons: string[] = [];
  const authFailures: string[] = [];
  const provider = new HocuspocusProvider({
    url: input.url,
    name: input.canvasId,
    document: input.doc ?? new Y.Doc(),
    token: input.token ?? "",
    WebSocketPolyfill: SessionWebSocket,
    onClose: ({ event }) => {
      if (event.reason) closeReasons.push(event.reason);
    },
    onAuthenticationFailed: ({ reason }) => {
      authFailures.push(reason);
    },
  });
  providers.push(provider);
  return { provider, doc: provider.document, closeReasons, authFailures };
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

async function createCanvas(ownerId: string) {
  return prisma.canvas.create({
    data: { name: "Sync canvas", userId: ownerId },
  });
}

async function share(
  canvasId: string,
  recipient: { id: string; email: string },
  role: "EDIT" | "VIEW" | "COMMENT",
) {
  return prisma.canvasShare.create({
    data: { canvasId, email: recipient.email, recipientId: recipient.id, role },
  });
}

function noteState(id: string, text: string, x = 10) {
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
        content: [{ type: "paragraph", content: [{ type: "text", text }] }],
      },
    },
  };
}

function noteFragment(doc: Y.Doc, itemId: string): Y.XmlFragment {
  return (documentItems(doc).get(itemId) as Y.Map<unknown>).get(
    "text",
  ) as Y.XmlFragment;
}

function firstText(doc: Y.Doc, itemId: string): Y.XmlText {
  const paragraph = noteFragment(doc, itemId).get(0) as Y.XmlElement;
  return paragraph.get(0) as Y.XmlText;
}

let owner: Awaited<ReturnType<typeof createSignedInUser>>;
let editor: Awaited<ReturnType<typeof createSignedInUser>>;
let viewer: Awaited<ReturnType<typeof createSignedInUser>>;

beforeAll(async () => {
  owner = await createSignedInUser("owner");
  editor = await createSignedInUser("editor");
  viewer = await createSignedInUser("viewer");
});

afterEach(async () => {
  for (const session of sessions.splice(0)) session.destroy();
  for (const provider of providers.splice(0)) provider.destroy();
  for (const server of servers.splice(0)) await server.destroy();
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("collaboration sync server", () => {
  it("converges two editors on the same item and the same note text", async () => {
    const canvas = await createCanvas(owner.user.id);
    await share(canvas.id, editor.user, "EDIT");
    const { url } = await startServer();
    const a = connect({ url, canvasId: canvas.id, cookie: owner.cookie });
    const b = connect({ url, canvasId: canvas.id, cookie: editor.cookie });
    await waitFor(() => a.provider.isSynced && b.provider.isSynced);

    const itemId = createCanvasItemId();
    a.doc.transact(() =>
      applyItemState(
        documentItems(a.doc),
        itemId,
        noteState(itemId, "Hello world"),
      ),
    );
    await waitForAcknowledged(a.provider);
    await waitFor(() => documentItems(b.doc).has(itemId));

    // Concurrent edits: both type into the same text and move the same item.
    firstText(a.doc, itemId).insert(0, "A: ");
    firstText(b.doc, itemId).insert("Hello world".length, " (B)");
    (documentItems(a.doc).get(itemId) as Y.Map<unknown>).set("positionX", 300);
    (documentItems(b.doc).get(itemId) as Y.Map<unknown>).set("positionY", 400);
    await waitForAcknowledged(a.provider);
    await waitForAcknowledged(b.provider);

    const expected = "A: Hello world (B)";
    await waitFor(
      () =>
        (
          readItemState(itemId, documentItems(a.doc).get(itemId)) as {
            content: { plainText: string };
          } | null
        )?.content.plainText === expected &&
        (
          readItemState(itemId, documentItems(b.doc).get(itemId)) as {
            content: { plainText: string };
          } | null
        )?.content.plainText === expected,
    );
    expect(Y.encodeStateVector(a.doc)).toEqual(Y.encodeStateVector(b.doc));
    expect(readAllItemStates(a.doc)).toEqual(readAllItemStates(b.doc));

    // The rows search, export, agents and the HTTP API read are in step.
    const row = await prisma.canvasItem.findUniqueOrThrow({
      where: { id: itemId },
    });
    expect(row).toMatchObject({
      canvasId: canvas.id,
      type: "NOTE",
      positionX: 300,
      positionY: 400,
      createdById: owner.user.id,
      deletedAt: null,
    });
    expect((row.content as { plainText: string }).plainText).toBe(expected);
    const events = await prisma.canvasEvent.count({
      where: { canvasId: canvas.id, entityId: itemId },
    });
    expect(events).toBeGreaterThanOrEqual(3);
  });

  it("refuses document changes from a viewer", async () => {
    const canvas = await createCanvas(owner.user.id);
    await share(canvas.id, viewer.user, "VIEW");
    const existingId = createCanvasItemId();
    await prisma.canvasItem.create({
      data: {
        ...noteState(existingId, "Read only"),
        canvasId: canvas.id,
        createdById: owner.user.id,
      },
    });
    const { server, url } = await startServer();
    const ownerClient = connect({
      url,
      canvasId: canvas.id,
      cookie: owner.cookie,
    });
    const viewerClient = connect({
      url,
      canvasId: canvas.id,
      cookie: viewer.cookie,
    });
    await waitFor(
      () => ownerClient.provider.isSynced && viewerClient.provider.isSynced,
    );
    expect(viewerClient.provider.authorizedScope).toBe("readonly");
    expect(documentItems(viewerClient.doc).has(existingId)).toBe(true);

    const intruderId = createCanvasItemId();
    viewerClient.doc.transact(() => {
      applyItemState(
        documentItems(viewerClient.doc),
        intruderId,
        noteState(intruderId, "nope"),
      );
      (documentItems(viewerClient.doc).get(existingId) as Y.Map<unknown>).set(
        "positionX",
        999,
      );
    });
    await new Promise((resolve) => setTimeout(resolve, 300));

    expect(viewerClient.provider.hasUnsyncedChanges).toBe(true);
    expect(documentItems(ownerClient.doc).has(intruderId)).toBe(false);
    expect(
      (documentItems(ownerClient.doc).get(existingId) as Y.Map<unknown>).get(
        "positionX",
      ),
    ).toBe(10);
    const live = server.hocuspocus.documents.get(canvas.id);
    expect(live && documentItems(live).has(intruderId)).toBe(false);
    expect(
      await prisma.canvasItem.count({ where: { canvasId: canvas.id } }),
    ).toBe(1);
    const row = await prisma.canvasItem.findUniqueOrThrow({
      where: { id: existingId },
    });
    expect(row.positionX).toBe(10);
  });

  it("keeps every acknowledged edit across a sync server restart", async () => {
    const canvas = await createCanvas(owner.user.id);
    const first = await startServer();
    const client = connect({
      url: first.url,
      canvasId: canvas.id,
      cookie: owner.cookie,
    });
    await waitFor(() => client.provider.isSynced);

    const itemId = createCanvasItemId();
    client.doc.transact(() =>
      applyItemState(
        documentItems(client.doc),
        itemId,
        noteState(itemId, "Durable"),
      ),
    );
    firstText(client.doc, itemId).insert(0, "Very ");
    await waitForAcknowledged(client.provider);

    // Acknowledged means stored: the database already holds it before any
    // shutdown hook or compaction runs.
    const persisted = await readPersistedCanvasDocument(prisma, canvas.id);
    expect(
      (
        readItemState(itemId, documentItems(persisted!.doc).get(itemId)) as {
          content: { plainText: string };
        }
      ).content.plainText,
    ).toBe("Very Durable");

    client.provider.destroy();
    await first.server.destroy();
    servers.splice(servers.indexOf(first.server), 1);

    const second = await startServer();
    const fresh = connect({
      url: second.url,
      canvasId: canvas.id,
      cookie: owner.cookie,
    });
    await waitFor(
      () => fresh.provider.isSynced && documentItems(fresh.doc).has(itemId),
    );
    expect(
      (
        readItemState(itemId, documentItems(fresh.doc).get(itemId)) as {
          content: { plainText: string };
        }
      ).content.plainText,
    ).toBe("Very Durable");
  });

  it("refuses an invalid update without keeping it and asks the client to resync", async () => {
    const canvas = await createCanvas(owner.user.id);
    const { server, url } = await startServer();
    const client = connect({ url, canvasId: canvas.id, cookie: owner.cookie });
    const watcher = connect({ url, canvasId: canvas.id, cookie: owner.cookie });
    await waitFor(() => client.provider.isSynced && watcher.provider.isSynced);

    const itemId = createCanvasItemId();
    client.doc.transact(() => {
      const item = new Y.Map<unknown>();
      documentItems(client.doc).set(itemId, item);
      item.set("type", "NOTE");
      item.set("positionX", 0);
      item.set("positionY", 0);
      item.set("width", -5);
      item.set("height", 10);
      item.set("zIndex", 0);
      item.set("tags", []);
      const text = new Y.XmlFragment();
      item.set("text", text);
      writeNoteFragment(text, {
        type: "doc",
        content: [
          { type: "paragraph", content: [{ type: "text", text: "bad" }] },
        ],
      });
    });
    await waitFor(() =>
      client.closeReasons.includes(SYNC_CLOSE_REASONS.invalidUpdate),
    );

    const live = server.hocuspocus.documents.get(canvas.id);
    expect(live && documentItems(live).has(itemId)).toBe(false);
    expect(documentItems(watcher.doc).has(itemId)).toBe(false);
    expect(
      await prisma.canvasItem.count({ where: { canvasId: canvas.id } }),
    ).toBe(0);

    // Changes outside the item map are refused too.
    const other = connect({ url, canvasId: canvas.id, cookie: owner.cookie });
    await waitFor(() => other.provider.isSynced);
    other.doc.getMap("elsewhere").set("x", 1);
    await waitFor(() =>
      other.closeReasons.includes(SYNC_CLOSE_REASONS.invalidUpdate),
    );

    // A valid update from a healthy client still goes through afterwards.
    const goodId = createCanvasItemId();
    watcher.doc.transact(() =>
      applyItemState(
        documentItems(watcher.doc),
        goodId,
        noteState(goodId, "fine"),
      ),
    );
    await waitForAcknowledged(watcher.provider);
    expect(
      await prisma.canvasItem.count({ where: { canvasId: canvas.id } }),
    ).toBe(1);
  });

  it("brings HTTP and agent row writes into open documents", async () => {
    const canvas = await createCanvas(owner.user.id);
    const { url } = await startServer();
    const client = connect({ url, canvasId: canvas.id, cookie: owner.cookie });
    await waitFor(() => client.provider.isSynced);

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
          tags: ["agent"],
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
    await waitFor(() => documentItems(client.doc).has(created.id));
    expect(
      readItemState(created.id, documentItems(client.doc).get(created.id)),
    ).toMatchObject({
      type: "SHAPE",
      positionX: 5,
      tags: ["agent"],
      content: { shapeType: "circle", fill: "#ff0000" },
    });

    await prisma.$transaction(async (tx) => {
      await lockCanvasForMutation(tx, canvas.id);
      const item = await tx.canvasItem.update({
        where: { id: created.id },
        data: { deletedAt: new Date(), version: { increment: 1 } },
      });
      await recordCanvasItemEvent(tx, {
        canvasId: canvas.id,
        actorId: owner.user.id,
        itemId: item.id,
        version: item.version,
        operation: "deleted",
      });
    });
    await waitFor(() => !documentItems(client.doc).has(created.id));
  });

  it("migrates an existing canvas into a document on first open", async () => {
    const canvas = await createCanvas(owner.user.id);
    const noteId = createCanvasItemId();
    await prisma.canvasItem.createMany({
      data: [
        {
          id: noteId,
          canvasId: canvas.id,
          type: "NOTE",
          positionX: 1,
          positionY: 2,
          width: 100,
          height: 100,
          content: { text: "<p>Legacy <strong>note</strong></p>" },
          createdById: owner.user.id,
        },
        {
          canvasId: canvas.id,
          type: "TEXT",
          positionX: 3,
          positionY: 4,
          width: 100,
          height: 40,
          content: { text: "Plain", fontSize: 14 },
          createdById: owner.user.id,
        },
        {
          canvasId: canvas.id,
          type: "TEXT",
          positionX: 3,
          positionY: 4,
          width: 100,
          height: 40,
          content: { text: "Trashed" },
          createdById: owner.user.id,
          deletedAt: new Date(),
        },
      ],
    });
    expect(
      await prisma.canvasDocument.count({ where: { canvasId: canvas.id } }),
    ).toBe(0);

    const { url } = await startServer();
    const client = connect({ url, canvasId: canvas.id, cookie: owner.cookie });
    await waitFor(
      () => client.provider.isSynced && documentItems(client.doc).size === 2,
    );
    const note = readItemState(
      noteId,
      documentItems(client.doc).get(noteId),
    ) as {
      content: { plainText: string };
    };
    expect(note.content.plainText).toBe("Legacy note");
    expect(
      await prisma.canvasDocument.count({ where: { canvasId: canvas.id } }),
    ).toBe(1);
  });

  it("disconnects a collaborator whose access is revoked", async () => {
    const canvas = await createCanvas(owner.user.id);
    const grant = await share(canvas.id, editor.user, "EDIT");
    const { url } = await startServer();
    const client = connect({ url, canvasId: canvas.id, cookie: editor.cookie });
    await waitFor(() => client.provider.isSynced);
    expect(client.provider.authorizedScope).toBe("read-write");

    await prisma.canvasShare.delete({ where: { id: grant.id } });
    await waitFor(() =>
      client.closeReasons.includes(SYNC_CLOSE_REASONS.forbidden),
    );

    // A reconnect is refused outright.
    const retry = connect({ url, canvasId: canvas.id, cookie: editor.cookie });
    await waitFor(() =>
      retry.authFailures.includes(SYNC_CLOSE_REASONS.forbidden),
    );
  });

  it("turns a downgraded share read-only and disconnects a signed-out session", async () => {
    const leaver = await createSignedInUser("leaver");
    const canvas = await createCanvas(owner.user.id);
    const grant = await share(canvas.id, leaver.user, "EDIT");
    const { server, url } = await startServer();
    const client = connect({ url, canvasId: canvas.id, cookie: leaver.cookie });
    await waitFor(() => client.provider.isSynced);

    await prisma.canvasShare.update({
      where: { id: grant.id },
      data: { role: "COMMENT" },
    });
    // The server applies the new role and asks the client to authenticate
    // again; the provider reconnects with a read-only scope.
    await waitFor(() =>
      client.closeReasons.includes(SYNC_CLOSE_REASONS.reauthenticate),
    );
    await waitFor(
      () =>
        client.provider.isSynced &&
        client.provider.authorizedScope === "readonly",
    );
    const itemId = createCanvasItemId();
    client.doc.transact(() =>
      applyItemState(
        documentItems(client.doc),
        itemId,
        noteState(itemId, "late"),
      ),
    );
    await new Promise((resolve) => setTimeout(resolve, 300));
    const live = server.hocuspocus.documents.get(canvas.id);
    expect(live && documentItems(live).has(itemId)).toBe(false);
    expect(
      await prisma.canvasItem.count({ where: { canvasId: canvas.id } }),
    ).toBe(0);

    // Signing out (or an administrator revoking sessions) deletes the row.
    await prisma.session.deleteMany({ where: { userId: leaver.user.id } });
    await waitFor(() =>
      client.closeReasons.includes(SYNC_CLOSE_REASONS.forbidden),
    );
  });

  it("lets a public-link guest read but not write, until the link is revoked", async () => {
    const canvas = await prisma.canvas.create({
      data: {
        name: "Public canvas",
        userId: owner.user.id,
        isPublic: true,
        shareToken: `share-${Date.now()}-${counter}`,
      },
    });
    const existingId = createCanvasItemId();
    await prisma.canvasItem.create({
      data: {
        ...noteState(existingId, "Public"),
        canvasId: canvas.id,
        createdById: owner.user.id,
      },
    });
    const { url } = await startServer();
    const wrongToken = connect({
      url,
      canvasId: canvas.id,
      token: "not-the-token",
    });
    await waitFor(() =>
      wrongToken.authFailures.includes(SYNC_CLOSE_REASONS.forbidden),
    );

    const guest = connect({
      url,
      canvasId: canvas.id,
      token: canvas.shareToken!,
    });
    await waitFor(
      () => guest.provider.isSynced && documentItems(guest.doc).has(existingId),
    );
    expect(guest.provider.authorizedScope).toBe("readonly");
    (documentItems(guest.doc).get(existingId) as Y.Map<unknown>).set(
      "positionX",
      500,
    );
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(
      (await prisma.canvasItem.findUniqueOrThrow({ where: { id: existingId } }))
        .positionX,
    ).toBe(10);

    await prisma.canvas.update({
      where: { id: canvas.id },
      data: { isPublic: false },
    });
    await waitFor(() =>
      guest.closeReasons.includes(SYNC_CLOSE_REASONS.forbidden),
    );
  });

  it("lets a signed-in stranger open a public canvas only with its current link (TASK-165)", async () => {
    const stranger = await createSignedInUser("stranger");
    const canvas = await prisma.canvas.create({
      data: {
        name: "Public canvas",
        userId: owner.user.id,
        isPublic: true,
        shareToken: `share-${Date.now()}-${counter}-stranger`,
      },
    });
    const { url } = await startServer();

    const byIdOnly = connect({
      url,
      canvasId: canvas.id,
      cookie: stranger.cookie,
    });
    await waitFor(() =>
      byIdOnly.authFailures.includes(SYNC_CLOSE_REASONS.forbidden),
    );

    const viaLink = connect({
      url,
      canvasId: canvas.id,
      cookie: stranger.cookie,
      token: canvas.shareToken!,
    });
    await waitFor(() => viaLink.provider.isSynced);
    expect(viaLink.provider.authorizedScope).toBe("readonly");

    // Rotating the link revokes the old one at the next refresh.
    await prisma.canvas.update({
      where: { id: canvas.id },
      data: { shareToken: `${canvas.shareToken}-rotated` },
    });
    await waitFor(() =>
      viaLink.closeReasons.includes(SYNC_CLOSE_REASONS.forbidden),
    );
  });

  it("refuses connections without a session or from another origin", async () => {
    const canvas = await createCanvas(owner.user.id);
    const { url } = await startServer();
    const anonymous = connect({ url, canvasId: canvas.id });
    await waitFor(() =>
      anonymous.authFailures.includes(SYNC_CLOSE_REASONS.forbidden),
    );

    const status = await new Promise<number>((resolve) => {
      const socket = new WebSocket(url, {
        headers: { origin: "https://evil.example", cookie: owner.cookie },
      });
      socket.on("unexpected-response", (_request, response) => {
        resolve(response.statusCode ?? 0);
        socket.terminate();
      });
      socket.on("open", () => {
        resolve(101);
        socket.close();
      });
      socket.on("error", () => undefined);
    });
    expect(status).toBe(403);
  });

  it("snapshots versions from the document and restores them into open documents", async () => {
    const canvas = await createCanvas(owner.user.id);
    routeAuth.userId = owner.user.id;
    const first = await startServer();
    const client = connect({
      url: first.url,
      canvasId: canvas.id,
      cookie: owner.cookie,
    });
    await waitFor(() => client.provider.isSynced);
    const noteId = createCanvasItemId();
    client.doc.transact(() =>
      applyItemState(
        documentItems(client.doc),
        noteId,
        noteState(noteId, "Version one"),
      ),
    );
    await waitForAcknowledged(client.provider);
    client.provider.destroy();
    await first.server.destroy();
    servers.splice(servers.indexOf(first.server), 1);

    // A row write while nobody has the canvas open is still in the snapshot.
    const shape = await prisma.$transaction(async (tx) => {
      await lockCanvasForMutation(tx, canvas.id);
      const item = await tx.canvasItem.create({
        data: {
          canvasId: canvas.id,
          type: "SHAPE",
          positionX: 1,
          positionY: 1,
          width: 10,
          height: 10,
          content: { shapeType: "star" },
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

    const created = await createVersion(
      new NextRequest(
        `http://localhost/api/v1/canvases/${canvas.id}/versions`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ name: "Before edits" }),
        },
      ),
      { params: Promise.resolve({ canvasId: canvas.id }) },
    );
    expect(created.status).toBe(201);
    const { id: versionId } = (await created.json()) as { id: string };
    const version = await prisma.canvasVersion.findUniqueOrThrow({
      where: { id: versionId },
    });
    const snapshotItems = (
      version.snapshot as { items: Array<{ id: string; content: any }> }
    ).items;
    expect(snapshotItems.map((item) => item.id).sort()).toEqual(
      [noteId, shape.id].sort(),
    );
    expect(
      snapshotItems.find((item) => item.id === noteId)!.content.plainText,
    ).toBe("Version one");
    const stored = new Y.Doc();
    Y.applyUpdate(stored, version.yjsState!);
    expect(
      readAllItemStates(stored)
        .map((item) => item.id)
        .sort(),
    ).toEqual([noteId, shape.id].sort());

    // Edit after the snapshot, then restore it while a client is connected.
    const second = await startServer();
    const editor = connect({
      url: second.url,
      canvasId: canvas.id,
      cookie: owner.cookie,
    });
    await waitFor(
      () => editor.provider.isSynced && documentItems(editor.doc).has(shape.id),
    );
    firstText(editor.doc, noteId).insert(0, "Not ");
    documentItems(editor.doc).delete(shape.id);
    await waitForAcknowledged(editor.provider);

    const restored = await restoreVersion(
      new NextRequest(
        `http://localhost/api/v1/canvases/${canvas.id}/versions/${versionId}/restore`,
        { method: "POST" },
      ),
      { params: Promise.resolve({ canvasId: canvas.id, versionId }) },
    );
    expect(restored.status).toBe(200);
    await waitFor(() => {
      const note = readItemState(
        noteId,
        documentItems(editor.doc).get(noteId),
      ) as { content: { plainText: string } } | null;
      return (
        note?.content.plainText === "Version one" &&
        documentItems(editor.doc).has(shape.id)
      );
    });
    const copy = await prisma.canvasVersion.findFirstOrThrow({
      where: { canvasId: canvas.id, name: "Restored Before edits" },
    });
    expect(copy.yjsState).toEqual(version.yjsState);
  });
});

/** The browser's document session, connected the way a browser connects. */
function openSession(input: {
  url: string;
  canvasId: string;
  cookie: string;
  onRejectedChange?: () => void;
}) {
  const headers = { origin: TEST_ORIGIN, cookie: input.cookie };
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
  });
  sessions.push(session);
  return session;
}

function noteInput(canvasId: string, text: string) {
  const { id: _id, ...state } = noteState("unused", text);
  return { ...state, canvasId };
}

function sessionText(session: CanvasDocumentSession, itemId: string) {
  const entry = session.getSnapshot().items.get(itemId);
  return (entry?.state.content as { plainText?: string } | undefined)
    ?.plainText;
}

async function waitForStored(session: CanvasDocumentSession) {
  await waitFor(() => {
    const snapshot = session.getSnapshot();
    return snapshot.connected && snapshot.pendingChanges === 0;
  });
}

describe("canvas document session", () => {
  it("writes through the document, keeps rows in step and converges", async () => {
    const canvas = await createCanvas(owner.user.id);
    await share(canvas.id, editor.user, "EDIT");
    const { url } = await startServer();
    const a = openSession({ url, canvasId: canvas.id, cookie: owner.cookie });
    const b = openSession({ url, canvasId: canvas.id, cookie: editor.cookie });
    await waitFor(() => a.acceptsWrites && b.acceptsWrites);

    const note = a.createItem(noteInput(canvas.id, "Hello"));
    expect(a.getSnapshot().items.get(note.id)?.state.positionX).toBe(10);
    await waitFor(() => b.getSnapshot().items.has(note.id));

    // Both edit the same note text and the same item at once.
    const textA = (a.noteFragment(note.id)!.get(0) as Y.XmlElement).get(
      0,
    ) as Y.XmlText;
    const textB = (b.noteFragment(note.id)!.get(0) as Y.XmlElement).get(
      0,
    ) as Y.XmlText;
    textA.insert(5, " world");
    textB.insert(0, "Oh, ");
    a.updateItem(note.id, { width: 260 });
    b.updateItem(note.id, { positionX: 40, tags: ["shared"] });
    await waitForStored(a);
    await waitForStored(b);

    const expected = "Oh, Hello world";
    await waitFor(
      () =>
        sessionText(a, note.id) === expected &&
        sessionText(b, note.id) === expected,
    );
    await waitFor(async () => {
      const row = await prisma.canvasItem.findUnique({
        where: { id: note.id },
      });
      return (row?.content as { plainText?: string })?.plainText === expected;
    });
    expect(
      await prisma.canvasItem.findUniqueOrThrow({ where: { id: note.id } }),
    ).toMatchObject({
      canvasId: canvas.id,
      positionX: 40,
      width: 260,
      tags: ["shared"],
      createdById: owner.user.id,
      updatedById: expect.any(String),
    });
    expect(a.getSnapshot().items.get(note.id)?.state).toEqual(
      b.getSnapshot().items.get(note.id)?.state,
    );

    b.deleteItem(note.id);
    await waitFor(() => !a.getSnapshot().items.has(note.id));
    await waitFor(
      async () =>
        (await prisma.canvasItem.findUniqueOrThrow({ where: { id: note.id } }))
          .deletedAt !== null,
    );
  });

  it("reloads the document when the server refuses a change", async () => {
    const canvas = await createCanvas(owner.user.id);
    const { url } = await startServer();
    let rejected = 0;
    const session = openSession({
      url,
      canvasId: canvas.id,
      cookie: owner.cookie,
      onRejectedChange: () => {
        rejected += 1;
      },
    });
    await waitFor(() => session.acceptsWrites);
    const note = session.createItem(noteInput(canvas.id, "Kept"));
    await waitForStored(session);

    // Markup the note schema does not allow, written past the editor.
    const fragment = session.noteFragment(note.id)!;
    fragment.doc!.transact(() =>
      fragment.insert(0, [new Y.XmlElement("script")]),
    );
    await waitFor(() => rejected === 1);
    expect(session.getSnapshot().generation).toBe(1);
    await waitFor(() => session.acceptsWrites);
    expect(session.noteFragment(note.id)!.toString()).not.toContain("script");
    expect(sessionText(session, note.id)).toBe("Kept");

    // The reloaded document keeps working.
    session.updateItem(note.id, { positionY: 99 });
    await waitFor(
      async () =>
        (await prisma.canvasItem.findUniqueOrThrow({ where: { id: note.id } }))
          .positionY === 99,
    );
  });

  it("follows role changes and stops when access is revoked", async () => {
    const member = await createSignedInUser("member");
    const canvas = await createCanvas(owner.user.id);
    const grant = await share(canvas.id, member.user, "VIEW");
    const { url } = await startServer();
    const session = openSession({
      url,
      canvasId: canvas.id,
      cookie: member.cookie,
    });
    await waitFor(() => session.getSnapshot().ready);
    expect(session.acceptsWrites).toBe(false);
    expect(() => session.createItem(noteInput(canvas.id, "No"))).toThrow();

    await prisma.canvasShare.update({
      where: { id: grant.id },
      data: { role: "EDIT" },
    });
    await waitFor(() => session.acceptsWrites);
    expect(session.getSnapshot().accessRevision).toBeGreaterThan(0);
    const note = session.createItem(noteInput(canvas.id, "Editor now"));
    await waitForStored(session);

    await prisma.canvasShare.update({
      where: { id: grant.id },
      data: { role: "VIEW" },
    });
    await waitFor(() => {
      const snapshot = session.getSnapshot();
      return snapshot.generation === 1 && snapshot.ready && !snapshot.writable;
    });
    expect(session.hasItem(note.id)).toBe(true);
    expect(session.acceptsWrites).toBe(false);

    await prisma.canvasShare.delete({ where: { id: grant.id } });
    await waitFor(() => session.getSnapshot().forbidden);
    expect(session.getSnapshot().connected).toBe(false);
  });
});
