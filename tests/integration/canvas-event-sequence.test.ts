/**
 * TASK-188 — per-canvas item event numbers are contiguous, serialized per
 * canvas, and survive rollbacks without holes, while the global sequence
 * they sit next to does not.
 * TASK-187 — the revision-only summary reads the replay seed in both cursor
 * spaces from one snapshot.
 */

import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

import type * as AuthModule from "@/lib/api/auth";

const authState = vi.hoisted(() => ({ userId: "", email: "" }));
vi.mock("@/lib/api/auth", async (importOriginal) => ({
  ...(await importOriginal<typeof AuthModule>()),
  requireAuth: async () => ({ ...authState }),
}));
vi.mock("@/lib/cache/redis-client", () => ({ getRedisClient: () => null }));

import { prisma } from "@/lib/db";
import {
  recordCanvasItemEvent,
  recordCanvasItemEventsBatch,
  toCommittedEventEnvelope,
} from "@/lib/collaboration/committed-events";

import { GET as summaryGet } from "@/app/api/v1/canvas-items/summary/route";
import { GET as eventsGet } from "@/app/api/v1/canvases/[canvasId]/events/route";
import { NextRequest } from "next/server";

const ITEM = "cjld2cjxh0000qzrmn831i7rn";

async function setup() {
  const owner = await prisma.user.create({
    data: { email: `evseq-${Date.now()}-${Math.random()}@example.com` },
  });
  authState.userId = owner.id;
  authState.email = owner.email;
  const [a, b] = await Promise.all(
    ["A", "B"].map((name) =>
      prisma.canvas.create({ data: { name, userId: owner.id } }),
    ),
  );
  return { owner, a: a!, b: b! };
}

const event = (canvasId: string, actorId: string) => ({
  canvasId,
  actorId,
  itemId: ITEM,
  version: 1,
  operation: "updated" as const,
});

const rowsOf = (canvasId: string) =>
  prisma.canvasEvent.findMany({
    where: { canvasId },
    orderBy: { sequence: "asc" },
  });

async function cleanup() {
  const canvases = await prisma.canvas.findMany({
    where: { user: { email: { startsWith: "evseq-" } } },
    select: { id: true },
  });
  await prisma.canvasEvent.deleteMany({
    where: { canvasId: { in: canvases.map((canvas) => canvas.id) } },
  });
  await prisma.user.deleteMany({ where: { email: { startsWith: "evseq-" } } });
}

beforeEach(cleanup);

afterAll(async () => {
  await cleanup();
  await prisma.$disconnect();
});

describe("per-canvas event numbers", () => {
  it("are contiguous per canvas across interleaved, concurrent and rolled-back writes", async () => {
    const { owner, a, b } = await setup();
    await recordCanvasItemEvent(prisma, event(a.id, owner.id));
    await recordCanvasItemEvent(prisma, event(b.id, owner.id));
    await recordCanvasItemEventsBatch(prisma, [
      event(a.id, owner.id),
      event(b.id, owner.id),
      event(a.id, owner.id),
    ]);
    // A rolled-back write gives its per-canvas number back, though not its
    // global sequence value.
    await expect(
      prisma.$transaction(async (tx) => {
        await recordCanvasItemEvent(tx, event(a.id, owner.id));
        throw new Error("rollback");
      }),
    ).rejects.toThrow("rollback");
    await Promise.all(
      Array.from({ length: 8 }, () =>
        prisma.$transaction((tx) =>
          recordCanvasItemEvent(tx, event(a.id, owner.id)),
        ),
      ),
    );

    for (const [canvas, count] of [
      [a, 11],
      [b, 2],
    ] as const) {
      const rows = await rowsOf(canvas.id);
      // Ordered by the global sequence: both orders agree per canvas.
      expect(rows.map((row) => Number(row.canvasSequence))).toEqual(
        Array.from({ length: count }, (_, index) => index + 1),
      );
      expect(
        rows.map((row) => toCommittedEventEnvelope(row).canvasCursor),
      ).toEqual(Array.from({ length: count }, (_, index) => String(index + 1)));
      const stored = await prisma.canvas.findUniqueOrThrow({
        where: { id: canvas.id },
      });
      expect(Number(stored.eventSequence)).toBe(count);
    }
    // The global sequence of canvas A does have holes (canvas B, rollback).
    const sequences = (await rowsOf(a.id)).map((row) => row.sequence);
    expect(sequences.at(-1)! - sequences[0]!).toBeGreaterThan(10n);
  });

  it("serves a replay seed after which the events route returns only later events", async () => {
    const { owner, a, b } = await setup();
    await recordCanvasItemEvent(prisma, event(a.id, owner.id));
    await recordCanvasItemEvent(prisma, event(b.id, owner.id));
    await recordCanvasItemEvent(prisma, event(a.id, owner.id));
    const response = await summaryGet(
      new Request(
        `http://localhost/api/v1/canvas-items/summary?canvasId=${a.id}&revisionOnly=1`,
      ),
    );
    expect(response.status).toBe(200);
    const seed = await response.json();
    const before = await rowsOf(a.id);
    expect(seed).toEqual({
      revision: before.at(-1)!.sequence.toString(),
      canvasRevision: "2",
    });

    // Committed after the seed was read: the replay from it returns exactly
    // this event, numbered right after the seed.
    await recordCanvasItemEvent(prisma, event(b.id, owner.id));
    const later = await recordCanvasItemEvent(prisma, event(a.id, owner.id));
    const replay = await eventsGet(
      new NextRequest(
        `http://localhost/api/v1/canvases/${a.id}/events?cursor=${seed.revision}&limit=200`,
      ),
      { params: Promise.resolve({ canvasId: a.id }) },
    );
    const body = await replay.json();
    expect(body.snapshotRequired).toBe(false);
    expect(
      body.events.map((item: { cursor: string; canvasCursor: string }) => [
        item.cursor,
        item.canvasCursor,
      ]),
    ).toEqual([[later.sequence.toString(), "3"]]);
  });
});
