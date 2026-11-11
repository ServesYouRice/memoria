import { randomBytes } from "crypto";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { UploadAssetStatus } from "@/generated/prisma/client";

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
vi.mock("@/lib/db", async () => {
  const { PrismaClient } = await import("@/generated/prisma/client");
  const { PrismaPg } = await import("@prisma/adapter-pg");
  return {
    prisma: new PrismaClient({
      adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
    }),
  };
});
const storage = vi.hoisted(() => ({ deleted: [] as string[] }));
vi.mock("@/lib/uploads/private-storage", () => ({
  deletePrivateUploadObject: vi.fn(async (_mode: string, key: string) => {
    storage.deleted.push(key);
  }),
}));

import { prisma } from "@/lib/db";
import { DELETE as deleteCanvas } from "@/app/api/v1/canvases/[canvasId]/route";
import { createUploadDeleteHandler } from "@/lib/uploads/outbox-handler";
import { enqueueOutboxJob } from "@/lib/outbox/enqueue";

type Status = "PENDING" | "ACTIVE" | "DELETING" | "FAILED" | "DELETED";

beforeEach(async () => {
  await prisma.outboxJob.deleteMany();
});
afterAll(async () => {
  await prisma.$disconnect();
});

let counter = 0;
async function createUser(assetCount: number, totalBytes: number) {
  counter += 1;
  const user = await prisma.user.create({
    data: { email: `canvas-quota-${Date.now()}-${counter}@example.com` },
  });
  await prisma.uploadQuota.create({
    data: { userId: user.id, assetCount, totalBytes: BigInt(totalBytes) },
  });
  return user;
}

async function createAsset(
  userId: string,
  canvasId: string,
  status: Status,
  size: number,
) {
  const asset = await prisma.uploadAsset.create({
    data: {
      userId,
      canvasId,
      storageKey: `uploads/${userId}/${Date.now()}-${Math.random()}.png`,
      // Local mode: deleting a missing file is a no-op.
      storageMode: "local",
      filename: "a.png",
      mimeType: "image/png",
      size,
      status,
    },
  });
  if (status === "DELETING") {
    // A delete queued before the canvas went away (charged job).
    await enqueueOutboxJob(prisma, {
      type: "upload.delete",
      dedupeKey: `upload.delete:${asset.id}`,
      payload: {
        assetId: asset.id,
        userId,
        storageMode: asset.storageMode,
        storageKey: asset.storageKey,
        size,
      },
    });
  }
  return asset;
}

async function quota(userId: string) {
  const row = await prisma.uploadQuota.findUniqueOrThrow({ where: { userId } });
  return { count: row.assetCount, bytes: Number(row.totalBytes) };
}

async function userWithQuota(
  label: string,
  assetCount: number,
  totalBytes: number,
) {
  const user = await prisma.user.create({
    data: { email: `${label}-${randomBytes(6).toString("hex")}@example.com` },
  });
  await prisma.uploadQuota.create({
    data: { userId: user.id, assetCount, totalBytes: BigInt(totalBytes) },
  });
  return user;
}

async function asset(
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

describe("canvas deletion releases upload quota", () => {
  it("debits each uploader for the canvas's charged assets only", async () => {
    // owner: ACTIVE 10, PENDING 20, DELETING 40, FAILED 80, DELETED 160 on
    // the canvas, ACTIVE 1000 elsewhere. Charged = PENDING/ACTIVE/DELETING.
    const owner = await createUser(4, 10 + 20 + 40 + 1000);
    // collaborator: ACTIVE 5 and FAILED 7 on the canvas, ACTIVE 3 elsewhere.
    const collaborator = await createUser(2, 5 + 3);
    const canvas = await prisma.canvas.create({
      data: { name: "Doomed", userId: owner.id },
    });
    const other = await prisma.canvas.create({
      data: { name: "Kept", userId: owner.id },
    });
    await createAsset(owner.id, canvas.id, "ACTIVE", 10);
    await createAsset(owner.id, canvas.id, "PENDING", 20);
    await createAsset(owner.id, canvas.id, "DELETING", 40);
    await createAsset(owner.id, canvas.id, "FAILED", 80);
    await createAsset(owner.id, canvas.id, "DELETED", 160);
    const kept = await createAsset(owner.id, other.id, "ACTIVE", 1000);
    await createAsset(collaborator.id, canvas.id, "ACTIVE", 5);
    await createAsset(collaborator.id, canvas.id, "FAILED", 7);
    const collaboratorKept = await createAsset(
      collaborator.id,
      other.id,
      "ACTIVE",
      3,
    );

    authState.userId = owner.id;
    const response = await deleteCanvas(
      new NextRequest(`http://localhost/api/v1/canvases/${canvas.id}`, {
        method: "DELETE",
      }),
      { params: Promise.resolve({ canvasId: canvas.id }) },
    );
    expect(response.status).toBe(200);

    // Released in the canvas delete transaction itself.
    expect(await quota(owner.id)).toEqual({ count: 1, bytes: 1000 });
    expect(await quota(collaborator.id)).toEqual({ count: 1, bytes: 3 });

    // Every remaining object still gets a durable delete job.
    const jobs = await prisma.outboxJob.findMany({
      where: { type: "upload.delete" },
    });
    expect(jobs).toHaveLength(6);

    const handler = createUploadDeleteHandler(prisma as never);
    for (const job of jobs) await handler(job as never, {} as never);

    expect(await quota(owner.id)).toEqual({ count: 1, bytes: 1000 });
    expect(await quota(collaborator.id)).toEqual({ count: 1, bytes: 3 });
    const remaining = await prisma.uploadAsset.findMany({
      where: { userId: { in: [owner.id, collaborator.id] } },
      select: { id: true, status: true },
    });
    expect(remaining.map((asset) => asset.id).sort()).toEqual(
      [kept.id, collaboratorKept.id].sort(),
    );
  });

  it("does not fail when the quota row has drifted below the canvas's assets", async () => {
    const owner = await createUser(0, 0);
    const canvas = await prisma.canvas.create({
      data: { name: "Drifted", userId: owner.id },
    });
    await createAsset(owner.id, canvas.id, "ACTIVE", 10);
    authState.userId = owner.id;
    const response = await deleteCanvas(
      new NextRequest(`http://localhost/api/v1/canvases/${canvas.id}`, {
        method: "DELETE",
      }),
      { params: Promise.resolve({ canvasId: canvas.id }) },
    );
    expect(response.status).toBe(200);
    expect(await quota(owner.id)).toEqual({ count: 0, bytes: 0 });
    expect(await prisma.canvas.findUnique({ where: { id: canvas.id } })).toBe(
      null,
    );
  });
});

describe("canvas deletion and upload quota", () => {
  it("releases each asset owner's quota exactly once", async () => {
    // Owner A has one asset on the canvas and one elsewhere; collaborator B
    // has one asset on the canvas.
    const owner = await userWithQuota("quota-owner", 2, 300);
    const collaborator = await userWithQuota("quota-collab", 1, 50);
    const canvas = await prisma.canvas.create({
      data: { name: "Doomed", userId: owner.id },
    });
    const other = await prisma.canvas.create({
      data: { name: "Kept", userId: owner.id },
    });
    const ownerAsset = await asset(
      owner.id,
      canvas.id,
      100,
      UploadAssetStatus.ACTIVE,
    );
    await asset(owner.id, other.id, 200, UploadAssetStatus.ACTIVE);
    const collabAsset = await asset(
      collaborator.id,
      canvas.id,
      50,
      UploadAssetStatus.ACTIVE,
    );
    authState.userId = owner.id;
    authState.email = owner.email;

    const response = await deleteCanvas(
      new NextRequest(`http://localhost/api/v1/canvases/${canvas.id}`, {
        method: "DELETE",
      }),
      { params: Promise.resolve({ canvasId: canvas.id }) },
    );
    expect(response.status).toBe(200);

    const jobs = await prisma.outboxJob.findMany({
      where: {
        type: "upload.delete",
        dedupeKey: {
          in: [
            `upload.delete:${ownerAsset.id}`,
            `upload.delete:${collabAsset.id}`,
          ],
        },
      },
    });
    expect(jobs).toHaveLength(2);
    const handler = createUploadDeleteHandler(prisma);
    for (const job of jobs) await handler(job);

    expect(storage.deleted).toEqual(
      expect.arrayContaining([ownerAsset.storageKey, collabAsset.storageKey]),
    );
    const ownerQuota = await prisma.uploadQuota.findUniqueOrThrow({
      where: { userId: owner.id },
    });
    const collabQuota = await prisma.uploadQuota.findUniqueOrThrow({
      where: { userId: collaborator.id },
    });
    expect([ownerQuota.assetCount, ownerQuota.totalBytes]).toEqual([1, 200n]);
    expect([collabQuota.assetCount, collabQuota.totalBytes]).toEqual([0, 0n]);

    // Running the jobs again (a redelivery) releases nothing more.
    for (const job of jobs) await handler(job);
    const again = await prisma.uploadQuota.findUniqueOrThrow({
      where: { userId: owner.id },
    });
    expect([again.assetCount, again.totalBytes]).toEqual([1, 200n]);
  });

  it("does not release quota a failed reservation already returned", async () => {
    const owner = await userWithQuota("quota-failed", 0, 0);
    const canvas = await prisma.canvas.create({
      data: { name: "Failed", userId: owner.id },
    });
    await asset(owner.id, canvas.id, 70, UploadAssetStatus.FAILED);
    authState.userId = owner.id;
    authState.email = owner.email;
    const response = await deleteCanvas(
      new NextRequest(`http://localhost/api/v1/canvases/${canvas.id}`, {
        method: "DELETE",
      }),
      { params: Promise.resolve({ canvasId: canvas.id }) },
    );
    expect(response.status).toBe(200);
    const quota = await prisma.uploadQuota.findUniqueOrThrow({
      where: { userId: owner.id },
    });
    expect([quota.assetCount, quota.totalBytes]).toEqual([0, 0n]);
  });
});
