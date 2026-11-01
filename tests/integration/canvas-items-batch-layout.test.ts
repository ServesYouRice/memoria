import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const authState = vi.hoisted(() => ({ userId: "", email: "" }));
const queries = vi.hoisted(() => ({ log: [] as string[] }));

vi.mock("@/lib/api/auth", () => ({
  requireAuth: async () => ({ ...authState }),
  requireCanvasAccess: async () => "OWNER",
}));
vi.mock("@/lib/auth", () => ({ auth: vi.fn(async () => null) }));
vi.mock("@/lib/cache/canvas-cache", () => ({
  invalidateCanvasCache: vi.fn(async () => undefined),
}));
// The route runs on a client that records every statement it sends.
vi.mock("@/lib/db", async () => {
  const { PrismaClient } = await import("@/generated/prisma/client");
  const { PrismaPg } = await import("@prisma/adapter-pg");
  const client = new PrismaClient({
    adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
    log: [{ emit: "event", level: "query" }],
  });
  client.$on("query", (event: { query: string }) => {
    queries.log.push(event.query);
  });
  return { prisma: client };
});

import { prisma } from "@/lib/db";
import { PATCH as batchLayout } from "@/app/api/v1/canvas-items/route";

let canvasId: string;
let otherCanvasId: string;
let userId: string;

type Item = { id: string; version: number };

async function createItems(targetCanvasId: string, count: number) {
  const before = new Set(
    (
      await prisma.canvasItem.findMany({
        where: { canvasId: targetCanvasId },
        select: { id: true },
      })
    ).map((item) => item.id),
  );
  await prisma.canvasItem.createMany({
    data: Array.from({ length: count }, (_, index) => ({
      canvasId: targetCanvasId,
      type: "NOTE" as const,
      positionX: index,
      positionY: index,
      width: 240,
      height: 120,
      content: { text: `item ${index}` },
      createdById: userId,
    })),
  });
  const rows = await prisma.canvasItem.findMany({
    where: { canvasId: targetCanvasId },
    orderBy: { positionX: "asc" },
    select: { id: true, version: true },
  });
  return rows.filter((row) => !before.has(row.id));
}

async function patch(body: unknown) {
  queries.log.length = 0;
  const response = await batchLayout(
    new NextRequest("http://localhost/api/v1/canvas-items", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
  return { response, statements: [...queries.log] };
}

function layout(items: Item[], offset = 1000) {
  return items.map((item, index) => ({
    id: item.id,
    version: item.version,
    positionX: offset + index + 0.5,
    positionY: offset - index - 0.25,
  }));
}

beforeAll(async () => {
  const user = await prisma.user.create({
    data: { email: `batch-layout-${Date.now()}@example.com` },
  });
  userId = user.id;
  authState.userId = user.id;
  authState.email = user.email;
  canvasId = (await prisma.canvas.create({ data: { name: "Batch", userId } }))
    .id;
  otherCanvasId = (
    await prisma.canvas.create({ data: { name: "Other", userId } })
  ).id;
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("batch layout PATCH on PostgreSQL", () => {
  it("applies 500 items in a constant number of statements", async () => {
    const small = await createItems(otherCanvasId, 5);
    const smallRun = await patch({
      canvasId: otherCanvasId,
      items: layout(small),
    });
    expect(smallRun.response.status).toBe(200);

    const items = await createItems(canvasId, 500);
    expect(items).toHaveLength(500);

    const { response, statements } = await patch({
      canvasId,
      items: layout(items),
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ updated: 500 });
    // Canvas lock, one UPDATE, one event INSERT, one outbox INSERT, COMMIT:
    // the same five for 5 and for 500 items.
    expect(statements.length).toBe(smallRun.statements.length);
    expect(statements).toHaveLength(5);
    expect(
      statements.filter((s) => s.includes('UPDATE "CanvasItem"')),
    ).toHaveLength(1);
    const byId = new Map(
      (await prisma.canvasItem.findMany({ where: { canvasId } })).map((row) => [
        row.id,
        row,
      ]),
    );
    layout(items).forEach((expected) => {
      const row = byId.get(expected.id)!;
      expect(row.positionX).toBe(expected.positionX);
      expect(row.positionY).toBe(expected.positionY);
      expect(row.version).toBe(expected.version + 1);
      expect(row.updatedById).toBe(userId);
    });

    const events = await prisma.canvasEvent.findMany({
      where: { canvasId },
      orderBy: { sequence: "asc" },
    });
    expect(events).toHaveLength(500);
    expect(events.map((event) => event.entityId)).toEqual(
      items.map((item) => item.id),
    );
    for (const event of events) {
      expect(event.operation).toBe("updated");
      expect(event.actorId).toBe(userId);
      expect(event.entityVersion).toBe(2);
    }
    const jobs = await prisma.outboxJob.findMany({
      where: {
        dedupeKey: { in: events.map((e) => `canvas.event.publish:${e.id}`) },
      },
    });
    expect(jobs).toHaveLength(500);
    expect(jobs.every((job) => job.type === "canvas.event.publish")).toBe(true);
  });

  it("conflicts on one stale version and rolls the whole batch back", async () => {
    const items = await createItems(otherCanvasId, 20);
    const stale = layout(items);
    stale[13] = { ...stale[13], version: stale[13].version + 5 };
    const ids = items.map((item) => item.id);
    const events = await prisma.canvasEvent.count({
      where: { canvasId: otherCanvasId },
    });
    const snapshot = await prisma.canvasItem.findMany({
      where: { id: { in: ids } },
      orderBy: { id: "asc" },
    });

    const { response } = await patch({ canvasId: otherCanvasId, items: stale });

    expect(response.status).toBe(409);
    expect(
      await prisma.canvasItem.findMany({
        where: { id: { in: ids } },
        orderBy: { id: "asc" },
      }),
    ).toEqual(snapshot);
    expect(
      await prisma.canvasEvent.count({ where: { canvasId: otherCanvasId } }),
    ).toBe(events);
  });

  it("conflicts on soft-deleted, missing and foreign-canvas items", async () => {
    const [a, b] = await createItems(canvasId, 2);
    await prisma.canvasItem.update({
      where: { id: a.id },
      data: { deletedAt: new Date() },
    });
    const [foreign] = await createItems(otherCanvasId, 1);
    const cases: Array<[string, Item[]]> = [
      ["soft-deleted", [b, a]],
      ["missing", [b, { id: "cjld2cjxh0000qzrmn831i7rn", version: 1 }]],
      ["foreign canvas", [b, foreign]],
    ];
    for (const [label, batch] of cases) {
      const { response } = await patch({
        canvasId,
        items: layout(batch, 5000),
      });
      expect(response.status, label).toBe(409);
    }
    const untouched = await prisma.canvasItem.findUnique({
      where: { id: b.id },
    });
    expect(untouched?.version).toBe(b.version);
  });

  it("conflicts when the same item appears twice", async () => {
    const [item] = await createItems(canvasId, 1);
    const { response } = await patch({
      canvasId,
      items: [
        { id: item.id, version: item.version, positionX: 1, positionY: 1 },
        { id: item.id, version: item.version, positionX: 2, positionY: 2 },
      ],
    });
    expect(response.status).toBe(409);
    const row = await prisma.canvasItem.findUnique({ where: { id: item.id } });
    expect(row?.version).toBe(item.version);
  });

  it("rejects a replay of already-applied versions", async () => {
    const [item] = await createItems(canvasId, 1);
    const body = { canvasId, items: layout([item], 7000) };
    expect((await patch(body)).response.status).toBe(200);
    expect((await patch(body)).response.status).toBe(409);
  });
});
