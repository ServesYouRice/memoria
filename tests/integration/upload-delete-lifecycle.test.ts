import { randomBytes } from "crypto";
import { afterAll, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { OutboxJobStatus, UploadAssetStatus } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";

const authState = vi.hoisted(() => ({ userId: "", email: "" }));
vi.mock("@/lib/api/auth", () => ({
  requireAuth: async () => ({ ...authState }),
  requireCanvasOwnership: async () => undefined,
  requireCanvasAccess: async () => "OWNER",
}));
vi.mock("@/lib/auth", () => ({ auth: vi.fn(async () => null) }));
vi.mock("@/lib/cache/canvas-cache", () => ({
  invalidateCanvasCache: vi.fn(async () => undefined),
}));
const storage = vi.hoisted(() => ({ deleted: [] as string[] }));
vi.mock("@/lib/uploads/private-storage", () => ({
  deletePrivateUploadObject: vi.fn(async (_mode: string, key: string) => {
    storage.deleted.push(key);
  }),
}));

import { DELETE as deleteCanvas } from "@/app/api/v1/canvases/[canvasId]/route";
import { enqueueUploadDeletion } from "@/lib/uploads/lifecycle";
import { createUploadDeleteHandler } from "@/lib/uploads/outbox-handler";

afterAll(async () => {
  await prisma.$disconnect();
});

async function fixture(assetCount: number, totalBytes: number) {
  const user = await prisma.user.create({
    data: { email: `udl-${randomBytes(6).toString("hex")}@example.com` },
  });
  await prisma.uploadQuota.create({
    data: { userId: user.id, assetCount, totalBytes: BigInt(totalBytes) },
  });
  const canvas = await prisma.canvas.create({
    data: { name: "Uploads", userId: user.id },
  });
  return { user, canvas };
}

function asset(
  userId: string,
  canvasId: string,
  size: number,
  status: UploadAssetStatus,
) {
  return prisma.uploadAsset.create({
    data: {
      userId,
      canvasId,
      storageKey: `uploads/${userId}/${randomBytes(8).toString("hex")}.png`,
      storageMode: "local",
      filename: "a.png",
      mimeType: "image/png",
      size,
      status,
    },
  });
}

const quotaOf = async (userId: string) => {
  const quota = await prisma.uploadQuota.findUniqueOrThrow({
    where: { userId },
  });
  return [quota.assetCount, quota.totalBytes];
};

describe("upload deletion lifecycle", () => {
  it("releases quota when the canvas delete moves assets to DELETING", async () => {
    const { user, canvas } = await fixture(2, 30);
    const active = await asset(
      user.id,
      canvas.id,
      10,
      UploadAssetStatus.ACTIVE,
    );
    const pending = await asset(
      user.id,
      canvas.id,
      20,
      UploadAssetStatus.PENDING,
    );
    authState.userId = user.id;
    authState.email = user.email;

    const response = await deleteCanvas(
      new NextRequest(`http://localhost/api/v1/canvases/${canvas.id}`, {
        method: "DELETE",
      }),
      { params: Promise.resolve({ canvasId: canvas.id }) },
    );
    expect(response.status).toBe(200);
    expect(await quotaOf(user.id)).toEqual([0, 0n]);

    const jobs = await prisma.outboxJob.findMany({
      where: {
        dedupeKey: {
          in: [`upload.delete:${active.id}`, `upload.delete:${pending.id}`],
        },
      },
    });
    expect(jobs).toHaveLength(2);
    for (const job of jobs) {
      expect(job.payload).toMatchObject({ quotaReleased: true });
    }
    const handler = createUploadDeleteHandler(prisma);
    for (const job of jobs) await handler(job);
    expect(storage.deleted).toEqual(
      expect.arrayContaining([active.storageKey, pending.storageKey]),
    );
    expect(await quotaOf(user.id)).toEqual([0, 0n]);
  });

  it("re-arms a DEAD upload.delete job when the asset is deleted again", async () => {
    const { user, canvas } = await fixture(1, 10);
    const stuck = await asset(user.id, canvas.id, 10, UploadAssetStatus.ACTIVE);
    await prisma.outboxJob.create({
      data: {
        type: "upload.delete",
        dedupeKey: `upload.delete:${stuck.id}`,
        payload: { assetId: stuck.id },
        status: OutboxJobStatus.DEAD,
        attempts: 8,
        nextRunAt: new Date(Date.now() - 3_600_000),
        lastError: "S3 unavailable",
        leaseOwner: "worker-1",
        leaseExpiresAt: new Date(),
      },
    });
    const before = Date.now();
    await prisma.$transaction((tx) => enqueueUploadDeletion(tx, stuck.id));
    const job = await prisma.outboxJob.findUniqueOrThrow({
      where: { dedupeKey: `upload.delete:${stuck.id}` },
    });
    expect(job).toMatchObject({
      status: OutboxJobStatus.PENDING,
      attempts: 0,
      lastError: null,
      leaseOwner: null,
      leaseExpiresAt: null,
    });
    expect(job.nextRunAt.getTime()).toBeGreaterThanOrEqual(before - 1000);
    expect(job.payload).toMatchObject({
      assetId: stuck.id,
      quotaReleased: true,
    });
  });

  it("does not release a FAILED or already DELETING asset's charge again", async () => {
    const { user, canvas } = await fixture(1, 20);
    const failed = await asset(user.id, canvas.id, 5, UploadAssetStatus.FAILED);
    const deleting = await asset(
      user.id,
      canvas.id,
      20,
      UploadAssetStatus.DELETING,
    );
    await prisma.$transaction(async (tx) => {
      await enqueueUploadDeletion(tx, failed.id);
      await enqueueUploadDeletion(tx, deleting.id);
    });
    expect(await quotaOf(user.id)).toEqual([1, 20n]);
    const failedRow = await prisma.uploadAsset.findUniqueOrThrow({
      where: { id: failed.id },
    });
    // TASK-219: FAILED never moves to DELETING; its uncharged job deletes
    // the object and marks it DELETED.
    expect(failedRow.status).toBe(UploadAssetStatus.FAILED);
    const failedJob = await prisma.outboxJob.findUniqueOrThrow({
      where: { dedupeKey: `upload.delete:${failed.id}` },
    });
    expect(failedJob.payload).toMatchObject({ quotaCharged: false });
    await createUploadDeleteHandler(prisma)(failedJob);
    expect(await quotaOf(user.id)).toEqual([1, 20n]);
    expect(
      (await prisma.uploadAsset.findUniqueOrThrow({ where: { id: failed.id } }))
        .status,
    ).toBe(UploadAssetStatus.DELETED);
  });

  it("keeps a legacy DEAD job's own quota release when re-arming it", async () => {
    const { user, canvas } = await fixture(1, 10);
    const legacy = await asset(
      user.id,
      canvas.id,
      10,
      UploadAssetStatus.DELETING,
    );
    await prisma.outboxJob.create({
      data: {
        type: "upload.delete",
        dedupeKey: `upload.delete:${legacy.id}`,
        payload: { assetId: legacy.id, userId: user.id, size: 10 },
        status: OutboxJobStatus.DEAD,
        attempts: 8,
      },
    });
    await prisma.$transaction((tx) => enqueueUploadDeletion(tx, legacy.id));
    const job = await prisma.outboxJob.findUniqueOrThrow({
      where: { dedupeKey: `upload.delete:${legacy.id}` },
    });
    expect(job.status).toBe(OutboxJobStatus.PENDING);
    expect(job.payload).toMatchObject({ quotaReleased: false });
    expect(await quotaOf(user.id)).toEqual([1, 10n]);
    await createUploadDeleteHandler(prisma)(job);
    expect(await quotaOf(user.id)).toEqual([0, 0n]);
  });
});
