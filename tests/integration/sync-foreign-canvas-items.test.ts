/**
 * TASK-147 — a board's document update that references an item a cross-board
 * move gave to another canvas skips that item instead of failing as a whole,
 * and never writes or emits events for the foreign row.
 */

import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/cache/redis-client", () => ({ getRedisClient: () => null }));

import * as Y from "yjs";
import { prisma } from "@/lib/db";
import { recordCanvasItemEvent } from "@/lib/collaboration/committed-events";
import { projectDocumentChanges } from "@/lib/collaboration/sync/projection";
import { CanvasSyncEngine } from "@/lib/collaboration/sync/engine";
import {
  applyItemState,
  createCanvasYDoc,
  documentItems,
  readItemState,
} from "@/lib/collaboration/sync/document-items";
import { createCanvasItemId } from "@/lib/collaboration/sync/protocol";
import { ItemType } from "@/types/canvas";

const logger = { info() {}, warn() {}, error() {} };

function shape(id: string, positionX = 0) {
  return {
    id,
    type: ItemType.SHAPE,
    positionX,
    positionY: 0,
    width: 40,
    height: 40,
    zIndex: 0,
    tags: [],
    content: { shapeType: "star" },
  };
}

async function setup() {
  const owner = await prisma.user.create({
    data: { email: `foreign-${Date.now()}-${Math.random()}@example.com` },
  });
  const [source, target] = await Promise.all(
    ["Source", "Target"].map((name) =>
      prisma.canvas.create({ data: { name, userId: owner.id } }),
    ),
  );
  const [moved, staying] = await Promise.all(
    [0, 1].map((index) =>
      prisma.canvasItem.create({
        data: {
          ...shape(createCanvasItemId(), index * 100),
          canvasId: source.id,
          createdById: owner.id,
        },
      }),
    ),
  );
  return { owner, source, target, moved, staying };
}

/** What an Ask cross-board move does: rewrite canvasId, emit both events. */
async function moveToCanvas(itemId: string, from: string, to: string) {
  await prisma.$transaction(async (tx) => {
    const row = await tx.canvasItem.update({
      where: { id: itemId },
      data: { canvasId: to, version: { increment: 1 } },
    });
    for (const [canvasId, operation] of [
      [from, "deleted"],
      [to, "created"],
    ] as const)
      await recordCanvasItemEvent(tx, {
        canvasId,
        actorId: row.createdById!,
        itemId,
        version: row.version,
        operation,
      });
  });
}

beforeEach(async () => {
  await prisma.canvas.deleteMany({
    where: { user: { email: { startsWith: "foreign-" } } },
  });
  await prisma.user.deleteMany({
    where: { email: { startsWith: "foreign-" } },
  });
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("projection of changes to rows owned by another canvas", () => {
  it("applies the valid changes and leaves the foreign row untouched", async () => {
    const { owner, source, target, moved, staying } = await setup();
    await moveToCanvas(moved.id, source.id, target.id);
    const before = await prisma.canvasItem.findUniqueOrThrow({
      where: { id: moved.id },
    });
    const eventsBefore = await prisma.canvasEvent.count({
      where: { entityId: moved.id },
    });

    const result = await prisma.$transaction((tx) =>
      projectDocumentChanges(tx, {
        canvasId: source.id,
        actorId: owner.id,
        changes: [
          {
            kind: "update",
            id: moved.id,
            type: ItemType.SHAPE,
            fields: { positionX: 999 },
            replaced: false,
          },
          {
            kind: "update",
            id: staying.id,
            type: ItemType.SHAPE,
            fields: { positionX: 555 },
            replaced: false,
          },
          { kind: "delete", id: moved.id },
        ],
      }),
    );

    expect(result).toMatchObject({ updated: 1, deleted: 0 });
    expect(result.skippedForeignIds).toEqual([moved.id]);
    const after = await prisma.canvasItem.findUniqueOrThrow({
      where: { id: moved.id },
    });
    expect(after).toEqual(before);
    expect(
      await prisma.canvasEvent.count({ where: { entityId: moved.id } }),
    ).toBe(eventsBefore);
    const kept = await prisma.canvasItem.findUniqueOrThrow({
      where: { id: staying.id },
    });
    expect(kept.positionX).toBe(555);
  });

  it("never writes a row for a create claiming another canvas's id", async () => {
    const { owner, source, target, moved } = await setup();
    await moveToCanvas(moved.id, source.id, target.id);
    const before = await prisma.canvasItem.findUniqueOrThrow({
      where: { id: moved.id },
    });
    const fresh = createCanvasItemId();

    const result = await prisma.$transaction((tx) =>
      projectDocumentChanges(tx, {
        canvasId: source.id,
        actorId: owner.id,
        changes: [
          { kind: "create", state: shape(moved.id, 777) },
          { kind: "create", state: shape(fresh, 1) },
        ],
      }),
    );

    expect(result.created).toBe(1);
    expect(
      await prisma.canvasItem.findUniqueOrThrow({ where: { id: moved.id } }),
    ).toEqual(before);
    const created = await prisma.canvasItem.findUniqueOrThrow({
      where: { id: fresh },
    });
    expect(created.canvasId).toBe(source.id);
  });
});

describe("source document convergence after a cross-board move", () => {
  async function openDocument(engine: CanvasSyncEngine, canvasId: string) {
    const live = createCanvasYDoc();
    Y.applyUpdate(live, await engine.load(canvasId));
    engine.attach(canvasId, live);
    return live;
  }

  function clientEdit(
    live: Y.Doc,
    edit: (items: Y.Map<Y.Map<unknown>>) => void,
  ) {
    const client = createCanvasYDoc();
    Y.applyUpdate(client, Y.encodeStateAsUpdate(live));
    const vector = Y.encodeStateVector(client);
    client.transact(() => edit(documentItems(client)));
    return Y.encodeStateAsUpdate(client, vector);
  }

  it("accepts an edit to the moved item and drops it from the source document", async () => {
    const { owner, source, target, moved, staying } = await setup();
    const engine = new CanvasSyncEngine({ prisma, logger });
    const live = await openDocument(engine, source.id);
    expect(documentItems(live).has(moved.id)).toBe(true);

    // The move commits before the source document reconciles it.
    await moveToCanvas(moved.id, source.id, target.id);
    const update = clientEdit(live, (items) => {
      applyItemState(items, moved.id, shape(moved.id, 999));
      applyItemState(items, staying.id, shape(staying.id, 321));
    });
    await engine.applyClientUpdate({
      canvasId: source.id,
      actorId: owner.id,
      update,
      origin: null,
    });

    const movedRow = await prisma.canvasItem.findUniqueOrThrow({
      where: { id: moved.id },
    });
    expect(movedRow.canvasId).toBe(target.id);
    expect(movedRow.positionX).toBe(0);
    const stayingRow = await prisma.canvasItem.findUniqueOrThrow({
      where: { id: staying.id },
    });
    expect(stayingRow.positionX).toBe(321);
    expect(documentItems(live).has(moved.id)).toBe(false);
    expect(
      readItemState(staying.id, documentItems(live).get(staying.id))?.positionX,
    ).toBe(321);

    // Reconciling the move's 'deleted' event keeps the item out, and a fresh
    // load of the stored document agrees.
    await engine.catchUp(source.id);
    expect(documentItems(live).has(moved.id)).toBe(false);
    const reloaded = new CanvasSyncEngine({ prisma, logger });
    const reopened = await openDocument(reloaded, source.id);
    expect(documentItems(reopened).has(moved.id)).toBe(false);
    expect(documentItems(reopened).has(staying.id)).toBe(true);
    await engine.drain();
    await reloaded.drain();
  });

  it("removes the moved item from the source document once its event is reconciled", async () => {
    const { source, target, moved } = await setup();
    const engine = new CanvasSyncEngine({ prisma, logger });
    const live = await openDocument(engine, source.id);
    await moveToCanvas(moved.id, source.id, target.id);
    await engine.catchUp(source.id);
    expect(documentItems(live).has(moved.id)).toBe(false);
    await engine.drain();
  });
});
