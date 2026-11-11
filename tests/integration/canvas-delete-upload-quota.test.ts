import { randomBytes } from "crypto";
import { afterAll, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { UploadAssetStatus } from "@/generated/prisma/client";
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
import { createUploadDeleteHandler } from "@/lib/uploads/outbox-handler";

afterAll(async () => {
  await prisma.$disconnect();
});

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
