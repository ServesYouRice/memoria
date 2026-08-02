import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { PrismaClient } from "@/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { enqueueOutboxJob } from "@/lib/outbox/enqueue";
import {
  claimOutboxJobs,
  failOutboxJob,
  replayDeadOutboxJob,
} from "@/lib/outbox/repository";
import {
  disablePublicCanvas,
  enablePublicCanvas,
  rotatePublicCanvasLink,
} from "@/lib/sharing/public-links";
import {
  enqueueUploadDeletion,
  reserveUploadAsset,
} from "@/lib/uploads/lifecycle";
import { decryptSecret, encryptSecret } from "@/lib/agents/crypto";
import { recordCanvasItemEvent } from "@/lib/collaboration/committed-events";
import { assertCanvasItemCapacity } from "@/lib/policy/capacity";
import { LAUNCH_LIMITS } from "@/lib/policy/launch-limits";
import {
  createTrashRetentionHandler,
  createVersionRetentionHandler,
} from "@/lib/retention/outbox-handler";

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.TEST_DATABASE_URL }),
});

beforeEach(async () => {
  await prisma.outboxJob.deleteMany();
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("PostgreSQL persistence contracts", () => {
  it("serializes concurrent item creates at the selected hard limit", async () => {
    const user = await prisma.user.create({
      data: { email: `item-limit-${Date.now()}@example.com` },
    });
    const canvas = await prisma.canvas.create({
      data: { name: "Limit", userId: user.id },
    });
    await prisma.canvasItem.createMany({
      data: Array.from(
        { length: LAUNCH_LIMITS.itemsPerCanvas - 1 },
        (_, index) => ({
          canvasId: canvas.id,
          type: "NOTE" as const,
          positionX: index,
          positionY: 0,
          width: 10,
          height: 10,
          content: { text: "limit" },
          createdById: user.id,
        }),
      ),
    });
    const create = () =>
      prisma.$transaction(async (tx) => {
        await assertCanvasItemCapacity(tx, canvas.id);
        return tx.canvasItem.create({
          data: {
            canvasId: canvas.id,
            type: "NOTE",
            positionX: 0,
            positionY: 0,
            width: 10,
            height: 10,
            content: { text: "last" },
            createdById: user.id,
          },
        });
      });
    const results = await Promise.allSettled([create(), create()]);
    const fulfilled = results.filter((result) => result.status === "fulfilled");
    const failures = results.filter(
      (result): result is PromiseRejectedResult => result.status === "rejected",
    );
    expect(
      fulfilled,
      failures.map((result) => String(result.reason)).join(" | "),
    ).toHaveLength(1);
    expect(
      await prisma.canvasItem.count({ where: { canvasId: canvas.id } }),
    ).toBe(LAUNCH_LIMITS.itemsPerCanvas);
  });

  it("retains recent trash and only the newest selected canvas versions", async () => {
    const user = await prisma.user.create({
      data: { email: `retention-${Date.now()}@example.com` },
    });
    const canvas = await prisma.canvas.create({
      data: { name: "Retention", userId: user.id },
    });
    await prisma.canvasVersion.createMany({
      data: Array.from(
        { length: LAUNCH_LIMITS.versionsPerCanvas + 1 },
        (_, index) => ({
          canvasId: canvas.id,
          name: `Version ${index}`,
          snapshot: {},
          createdAt: new Date(Date.now() + index * 1000),
        }),
      ),
    });
    const [oldItem, recentItem] = await Promise.all([
      prisma.canvasItem.create({
        data: {
          canvasId: canvas.id,
          type: "NOTE",
          positionX: 0,
          positionY: 0,
          width: 10,
          height: 10,
          content: { text: "old" },
          createdById: user.id,
          deletedAt: new Date(Date.now() - 31 * 86_400_000),
        },
      }),
      prisma.canvasItem.create({
        data: {
          canvasId: canvas.id,
          type: "NOTE",
          positionX: 0,
          positionY: 0,
          width: 10,
          height: 10,
          content: { text: "recent" },
          createdById: user.id,
          deletedAt: new Date(Date.now() - 29 * 86_400_000),
        },
      }),
    ]);
    await createTrashRetentionHandler(prisma)({} as never);
    await createVersionRetentionHandler(prisma)({} as never);
    expect(
      await prisma.canvasItem.findUnique({ where: { id: oldItem.id } }),
    ).toBeNull();
    expect(
      await prisma.canvasItem.findUnique({ where: { id: recentItem.id } }),
    ).not.toBeNull();
    expect(
      await prisma.canvasVersion.count({ where: { canvasId: canvas.id } }),
    ).toBe(LAUNCH_LIMITS.versionsPerCanvas);
  });

  it("commits ordered update and deletion events with durable publish intents", async () => {
    const user = await prisma.user.create({
      data: { email: `events-${Date.now()}@example.com`, name: "Events" },
    });
    const canvas = await prisma.canvas.create({
      data: { name: "Events", userId: user.id },
    });
    const item = await prisma.canvasItem.create({
      data: {
        canvasId: canvas.id,
        type: "NOTE",
        positionX: 0,
        positionY: 0,
        width: 100,
        height: 100,
        content: { text: "event" },
        createdById: user.id,
      },
    });
    await prisma.$transaction(async (tx) => {
      await recordCanvasItemEvent(tx, {
        canvasId: canvas.id,
        actorId: user.id,
        itemId: item.id,
        version: 2,
        operation: "updated",
      });
      await recordCanvasItemEvent(tx, {
        canvasId: canvas.id,
        actorId: user.id,
        itemId: item.id,
        version: 3,
        operation: "deleted",
      });
    });
    const events = await prisma.canvasEvent.findMany({
      where: { canvasId: canvas.id },
      orderBy: { sequence: "asc" },
    });
    expect(
      events.map((entry) => [entry.operation, entry.entityVersion]),
    ).toEqual([
      ["updated", 2],
      ["deleted", 3],
    ]);
    expect(events[1]!.sequence).toBeGreaterThan(events[0]!.sequence);
    expect(
      await prisma.outboxJob.count({ where: { type: "canvas.event.publish" } }),
    ).toBe(2);
  });

  it("commits a verification token and minimized delivery intent atomically", async () => {
    const raw = "integration-verification-value";
    const verification = await prisma.$transaction(async (tx) => {
      const token = await tx.emailVerificationToken.create({
        data: {
          token: `hash-${Date.now()}`,
          email: "delivery@example.com",
          expiresAt: new Date(Date.now() + 60_000),
          deliverySecret: encryptSecret(raw),
        },
      });
      await enqueueOutboxJob(tx, {
        type: "email.verification",
        payload: { verificationId: token.id },
        dedupeKey: `email-verification:${token.id}`,
      });
      return token;
    });
    const intent = await prisma.outboxJob.findUniqueOrThrow({
      where: { dedupeKey: `email-verification:${verification.id}` },
    });
    expect(intent.payload).toEqual({ verificationId: verification.id });
    expect(JSON.stringify(intent.payload)).not.toContain(raw);
    expect(decryptSecret(verification.deliverySecret!)).toBe(raw);
  });

  it("deduplicates enqueue and gives one concurrent worker the lease", async () => {
    await prisma.$transaction(async (tx) => {
      await enqueueOutboxJob(tx, {
        type: "test.delivery",
        payload: { entityId: "entity-1" },
        dedupeKey: "delivery:entity-1",
      });
      await enqueueOutboxJob(tx, {
        type: "test.delivery",
        payload: { entityId: "entity-1" },
        dedupeKey: "delivery:entity-1",
      });
    });
    expect(await prisma.outboxJob.count()).toBe(1);

    const [first, second] = await Promise.all([
      claimOutboxJobs(prisma, {
        owner: "worker-a",
        limit: 1,
        leaseMs: 30_000,
        types: ["test.delivery"],
      }),
      claimOutboxJobs(prisma, {
        owner: "worker-b",
        limit: 1,
        leaseMs: 30_000,
        types: ["test.delivery"],
      }),
    ]);
    expect(first.length + second.length).toBe(1);
  });

  it("dead-letters at max attempts and can be replayed", async () => {
    const job = await prisma.outboxJob.create({
      data: {
        type: "test.delivery",
        payload: {},
        status: "RUNNING",
        attempts: 2,
        maxAttempts: 2,
        leaseOwner: "worker-a",
        leaseExpiresAt: new Date(Date.now() + 30_000),
      },
    });
    await failOutboxJob(prisma, job, "worker-a", new Error("safe failure"));
    expect(
      (await prisma.outboxJob.findUniqueOrThrow({ where: { id: job.id } }))
        .status,
    ).toBe("DEAD");
    await replayDeadOutboxJob(prisma, job.id);
    expect(
      await prisma.outboxJob.findUniqueOrThrow({ where: { id: job.id } }),
    ).toMatchObject({ status: "PENDING", attempts: 0 });
  });

  it("cascades canvas deletion to items and upload metadata", async () => {
    const user = await prisma.user.create({
      data: { email: `integration-${Date.now()}@example.com` },
    });
    const canvas = await prisma.canvas.create({
      data: { name: "Cascade", userId: user.id },
    });
    await prisma.canvasItem.create({
      data: {
        canvasId: canvas.id,
        type: "NOTE",
        positionX: 0,
        positionY: 0,
        width: 100,
        height: 100,
        content: { text: "test" },
        createdById: user.id,
      },
    });
    await prisma.uploadAsset.create({
      data: {
        userId: user.id,
        canvasId: canvas.id,
        storageKey: `uploads/${user.id}/test.png`,
        storageMode: "s3",
        filename: "test.png",
        mimeType: "image/png",
        size: 1,
      },
    });
    await prisma.canvas.delete({ where: { id: canvas.id } });
    expect(
      await prisma.canvasItem.count({ where: { canvasId: canvas.id } }),
    ).toBe(0);
    expect(
      await prisma.uploadAsset.count({ where: { canvasId: canvas.id } }),
    ).toBe(0);
  });

  it("permanently revokes disabled and rotated public URLs", async () => {
    const user = await prisma.user.create({
      data: { email: `sharing-${Date.now()}@example.com` },
    });
    const canvas = await prisma.canvas.create({
      data: { name: "Public", userId: user.id },
    });
    const enabled = await enablePublicCanvas(prisma, canvas.id, user.id);
    const firstToken = enabled.shareToken;
    await disablePublicCanvas(prisma, canvas.id, user.id);
    expect(
      await prisma.canvas.findUnique({ where: { shareToken: firstToken! } }),
    ).toBeNull();
    const reenabled = await enablePublicCanvas(prisma, canvas.id, user.id);
    expect(reenabled.shareToken).not.toBe(firstToken);
    const rotated = await rotatePublicCanvasLink(prisma, canvas.id, user.id);
    expect(rotated.shareToken).not.toBe(reenabled.shareToken);
    expect(
      await prisma.canvas.findUnique({
        where: { shareToken: reenabled.shareToken! },
      }),
    ).toBeNull();
  });

  it("concurrent enables converge on one active token", async () => {
    const user = await prisma.user.create({
      data: { email: `concurrent-sharing-${Date.now()}@example.com` },
    });
    const canvas = await prisma.canvas.create({
      data: { name: "Concurrent", userId: user.id },
    });
    const results = await Promise.all([
      enablePublicCanvas(prisma, canvas.id, user.id),
      enablePublicCanvas(prisma, canvas.id, user.id),
    ]);
    expect(results[0].shareToken).toBe(results[1].shareToken);
  });

  it("atomically prevents concurrent upload quota overflow and deduplicates deletion", async () => {
    const user = await prisma.user.create({
      data: { email: `quota-${Date.now()}@example.com` },
    });
    const canvas = await prisma.canvas.create({
      data: { name: "Quota", userId: user.id },
    });
    const reserve = (storageKey: string) =>
      reserveUploadAsset(prisma, {
        userId: user.id,
        canvasId: canvas.id,
        storageKey,
        storageMode: "s3",
        filename: "test.png",
        mimeType: "image/png",
        size: 10,
        maxFiles: 1,
        maxBytes: 100,
      });
    const reservations = await Promise.allSettled([
      reserve(`uploads/${user.id}/one.png`),
      reserve(`uploads/${user.id}/two.png`),
    ]);
    const fulfilled = reservations.filter(
      (
        result,
      ): result is PromiseFulfilledResult<
        Awaited<ReturnType<typeof reserve>>
      > => result.status === "fulfilled",
    );
    expect(fulfilled).toHaveLength(1);
    const asset = fulfilled[0]!.value;
    await prisma.$transaction(async (tx) => {
      await enqueueUploadDeletion(tx, asset.id);
      await enqueueUploadDeletion(tx, asset.id);
    });
    expect(
      await prisma.outboxJob.count({
        where: { dedupeKey: `upload.delete:${asset.id}` },
      }),
    ).toBe(1);
  });
});
