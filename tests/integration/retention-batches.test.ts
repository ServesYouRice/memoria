import { randomBytes } from "crypto";
import { afterAll, describe, expect, it } from "vitest";
import type { OutboxJob } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import {
  createMaintenanceRetentionHandler,
  createTrashRetentionHandler,
  createVersionRetentionHandler,
} from "@/lib/retention/outbox-handler";
import type { OutboxHandler } from "@/lib/outbox/types";
import { LAUNCH_LIMITS } from "@/lib/policy/launch-limits";

afterAll(async () => {
  await prisma.$disconnect();
});

const ELIGIBLE = 1200;
const KEPT = 50;
const DAY = 86_400_000;

function range(count: number) {
  return Array.from({ length: count }, (_, index) => index);
}

async function seed() {
  const tag = randomBytes(6).toString("hex");
  const user = await prisma.user.create({
    data: { email: `retention-${tag}@example.com` },
  });
  const canvas = await prisma.canvas.create({
    data: { name: "Retention", userId: user.id },
  });
  const item = (deletedAt: Date | null, archivedAt: Date | null = null) => ({
    canvasId: canvas.id,
    type: "NOTE",
    positionX: 0,
    positionY: 0,
    width: 100,
    height: 100,
    content: { text: "x" },
    createdById: user.id,
    deletedAt,
    archivedAt,
  });
  const expired = new Date(Date.now() - 400 * DAY);
  await prisma.canvasItem.createMany({
    data: [
      ...range(ELIGIBLE).map(() => item(expired)),
      ...range(KEPT).map(() => item(new Date())),
      ...range(KEPT).map(() => item(expired, expired)),
    ],
  });
  await prisma.canvasVersion.createMany({
    data: range(ELIGIBLE + LAUNCH_LIMITS.versionsPerCanvas).map((index) => ({
      canvasId: canvas.id,
      name: `v${index}`,
      snapshot: {},
      kind: "MANUAL" as const,
      createdAt: new Date(Date.now() - (index + 1) * 1000),
    })),
  });
  await prisma.canvasVersion.createMany({
    data: range(KEPT).map((index) => ({
      canvasId: canvas.id,
      name: `auto${index}`,
      snapshot: {},
      kind: "AUTO" as const,
    })),
  });
  const key = (index: number, createdAt: Date) => ({
    key: `${tag}-${index}`,
    userId: user.id,
    path: "/api/v1/test",
    method: "POST",
    createdAt,
  });
  await prisma.idempotencyKey.createMany({
    data: [
      ...range(ELIGIBLE).map((index) =>
        key(index, new Date(Date.now() - 2 * DAY)),
      ),
      ...range(KEPT).map((index) => key(ELIGIBLE + index, new Date())),
    ],
  });
  const candidate = (revision: number, createdAt: Date) => ({
    canvasId: canvas.id,
    revision: BigInt(revision),
    mimeType: "image/png",
    bytes: Buffer.from([1]),
    createdAt,
  });
  await prisma.canvasThumbnailCandidate.createMany({
    data: [
      ...range(ELIGIBLE).map((index) =>
        candidate(index, new Date(Date.now() - 2 * 60 * 60 * 1000)),
      ),
      ...range(KEPT).map((index) => candidate(ELIGIBLE + index, new Date())),
    ],
  });
  return { user, canvas, tag };
}

async function counts(canvasId: string, userId: string) {
  return {
    expiredTrash: await prisma.canvasItem.count({
      where: {
        canvasId,
        archivedAt: null,
        deletedAt: { lt: new Date(Date.now() - 31 * DAY) },
      },
    }),
    keptItems: await prisma.canvasItem.count({
      where: {
        canvasId,
        OR: [
          { archivedAt: { not: null } },
          { deletedAt: { gte: new Date(Date.now() - DAY) } },
        ],
      },
    }),
    manualVersions: await prisma.canvasVersion.count({
      where: { canvasId, kind: "MANUAL" },
    }),
    autoVersions: await prisma.canvasVersion.count({
      where: { canvasId, kind: "AUTO" },
    }),
    oldKeys: await prisma.idempotencyKey.count({
      where: { userId, createdAt: { lt: new Date(Date.now() - DAY) } },
    }),
    newKeys: await prisma.idempotencyKey.count({
      where: { userId, createdAt: { gte: new Date(Date.now() - DAY) } },
    }),
    oldCandidates: await prisma.canvasThumbnailCandidate.count({
      where: {
        canvasId,
        createdAt: { lt: new Date(Date.now() - 60 * 60 * 1000) },
      },
    }),
    newCandidates: await prisma.canvasThumbnailCandidate.count({
      where: {
        canvasId,
        createdAt: { gte: new Date(Date.now() - 60 * 60 * 1000) },
      },
    }),
  };
}

const expected = {
  expiredTrash: 0,
  keptItems: 2 * KEPT,
  manualVersions: LAUNCH_LIMITS.versionsPerCanvas,
  autoVersions: KEPT,
  oldKeys: 0,
  newKeys: KEPT,
  oldCandidates: 0,
  newCandidates: KEPT,
};

function cronJob(type: string): OutboxJob {
  return {
    id: `job-${randomBytes(6).toString("hex")}`,
    type,
    payload: {},
  } as unknown as OutboxJob;
}

const handlers: Record<string, OutboxHandler> = {
  "retention.trash": createTrashRetentionHandler(prisma),
  "retention.versions": createVersionRetentionHandler(prisma),
  "retention.maintenance": createMaintenanceRetentionHandler(prisma),
};

describe("retention runs in bounded batches (PostgreSQL)", () => {
  it("clears more than one batch of every kind in one run", async () => {
    const { user, canvas } = await seed();

    for (const [type, handler] of Object.entries(handlers)) {
      await handler(cronJob(type));
    }

    expect(await counts(canvas.id, user.id)).toEqual(expected);
  });

  it("queues one continuation when the time budget stops a full batch", async () => {
    const { user, canvas } = await seed();

    for (const [type, handler] of Object.entries(handlers)) {
      let job = cronJob(type);
      // A deadline already passed: each run deletes one batch, then stops.
      const exhausted = () => ({
        signal: new AbortController().signal,
        deliveryId: "delivery",
        deadlineAt: new Date(Date.now() - 1),
      });
      await handler(job, exhausted());
      const continuation = await prisma.outboxJob.findUnique({
        where: { dedupeKey: `${type}:continuation:${job.id}` },
      });
      expect(continuation).toMatchObject({ type, status: "PENDING" });

      // Running the continuations (as the worker would) finishes the work.
      let next = continuation;
      for (let runs = 0; next && runs < 30; runs++) {
        job = next;
        await handler(job, exhausted());
        next = await prisma.outboxJob.findUnique({
          where: { dedupeKey: `${type}:continuation:${job.id}` },
        });
      }
      expect(next).toBeNull();
    }

    expect(await counts(canvas.id, user.id)).toEqual(expected);
  });
});
