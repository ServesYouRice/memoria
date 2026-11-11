import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { PrismaClient } from "@/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import {
  activateUploadAsset,
  enqueueUploadDeletion,
  failUploadReservation,
  reserveUploadAsset,
} from "@/lib/uploads/lifecycle";
import { createUploadDeleteHandler } from "@/lib/uploads/outbox-handler";
import { enqueueOutboxJob } from "@/lib/outbox/enqueue";

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.TEST_DATABASE_URL }),
});

beforeEach(async () => {
  await prisma.outboxJob.deleteMany();
});
afterAll(async () => {
  await prisma.$disconnect();
});

let counter = 0;
async function setup() {
  counter += 1;
  const user = await prisma.user.create({
    data: { email: `upload-state-${Date.now()}-${counter}@example.com` },
  });
  const canvas = await prisma.canvas.create({
    data: { name: "Uploads", userId: user.id },
  });
  const reserve = () =>
    reserveUploadAsset(prisma, {
      userId: user.id,
      canvasId: canvas.id,
      storageKey: `uploads/${user.id}/${Date.now()}-${Math.random()}.png`,
      // Local mode: deleting a missing file is a no-op, no object store needed.
      storageMode: "local",
      filename: "test.png",
      mimeType: "image/png",
      size: 10,
      maxFiles: 10,
      maxBytes: 1_000,
    });
  const quota = async () => {
    const row = await prisma.uploadQuota.findUniqueOrThrow({
      where: { userId: user.id },
    });
    return { count: row.assetCount, bytes: Number(row.totalBytes) };
  };
  return { user, reserve, quota };
}

async function runDeleteJobs() {
  const handler = createUploadDeleteHandler(prisma);
  const jobs = await prisma.outboxJob.findMany({
    where: { type: "upload.delete" },
  });
  for (const job of jobs) {
    await handler(job as never, {} as never);
  }
  return jobs;
}

describe("upload asset state machine", () => {
  it("deletes a FAILED upload without debiting quota a second time", async () => {
    const { reserve, quota } = await setup();
    const keep = await reserve();
    await activateUploadAsset(prisma, keep.id);
    const asset = await reserve();
    await failUploadReservation(prisma, asset.id, "write failed");
    const before = await quota();
    expect(before).toEqual({ count: 1, bytes: 10 });

    await prisma.$transaction((tx) => enqueueUploadDeletion(tx, asset.id));
    expect(
      (await prisma.uploadAsset.findUniqueOrThrow({ where: { id: asset.id } }))
        .status,
    ).toBe("FAILED");
    await runDeleteJobs();

    expect(await quota()).toEqual(before);
    expect(
      (await prisma.uploadAsset.findUniqueOrThrow({ where: { id: asset.id } }))
        .status,
    ).toBe("DELETED");
  });

  it("keeps a DELETED asset DELETED when it is deleted again", async () => {
    const { reserve, quota } = await setup();
    const asset = await reserve();
    await activateUploadAsset(prisma, asset.id);
    await prisma.$transaction((tx) => enqueueUploadDeletion(tx, asset.id));
    await runDeleteJobs();
    expect(await quota()).toEqual({ count: 0, bytes: 0 });

    await prisma.$transaction((tx) => enqueueUploadDeletion(tx, asset.id));
    expect(
      (await prisma.uploadAsset.findUniqueOrThrow({ where: { id: asset.id } }))
        .status,
    ).toBe("DELETED");
    expect(await quota()).toEqual({ count: 0, bytes: 0 });
  });

  it("never lets activation overwrite DELETING", async () => {
    const { reserve } = await setup();
    const asset = await reserve();
    await prisma.$transaction((tx) => enqueueUploadDeletion(tx, asset.id));
    await expect(activateUploadAsset(prisma, asset.id)).rejects.toThrow();
    expect(
      (await prisma.uploadAsset.findUniqueOrThrow({ where: { id: asset.id } }))
        .status,
    ).toBe("DELETING");
  });

  it("refuses a direct delete while an upload is in progress", async () => {
    const { reserve } = await setup();
    const asset = await reserve();
    await expect(
      prisma.$transaction((tx) =>
        enqueueUploadDeletion(tx, asset.id, { inProgress: "conflict" }),
      ),
    ).rejects.toMatchObject({ status: 409 });
    expect(
      (await prisma.uploadAsset.findUniqueOrThrow({ where: { id: asset.id } }))
        .status,
    ).toBe("PENDING");
  });

  it("debits quota once for a job queued before quotaCharged existed", async () => {
    const { reserve, quota } = await setup();
    const asset = await reserve();
    await activateUploadAsset(prisma, asset.id);
    await prisma.$transaction(async (tx) => {
      await tx.uploadAsset.update({
        where: { id: asset.id },
        data: { status: "DELETING" },
      });
      await enqueueOutboxJob(tx, {
        type: "upload.delete",
        dedupeKey: `upload.delete:${asset.id}`,
        payload: {
          assetId: asset.id,
          userId: asset.userId,
          storageMode: asset.storageMode,
          storageKey: asset.storageKey,
          size: asset.size,
        },
      });
    });
    await runDeleteJobs();
    await runDeleteJobs();
    expect(await quota()).toEqual({ count: 0, bytes: 0 });
  });
});
