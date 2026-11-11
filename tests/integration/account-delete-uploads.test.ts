import { randomBytes } from "crypto";
import { afterAll, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { UploadAssetStatus } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import type * as ApiAuth from "@/lib/api/auth";

const authState = vi.hoisted(() => ({ userId: "", email: "" }));
const sessionState = vi.hoisted(() => ({
  user: null as null | { id: string; email: string },
}));

vi.mock("@/lib/api/auth", async (importOriginal) => ({
  ...(await importOriginal<typeof ApiAuth>()),
  requireAuth: async () => ({ ...authState }),
}));
vi.mock("@/lib/auth", () => ({
  auth: vi.fn(async () =>
    sessionState.user ? { user: sessionState.user } : null,
  ),
}));
vi.mock("@/lib/auth/credentials", () => ({
  getCredentialPasswordHash: vi.fn(async () => "stored-hash"),
}));
vi.mock("@/lib/auth/password", () => ({
  verifyPassword: vi.fn(async () => true),
}));

import { DELETE as deleteAccount } from "@/app/api/v1/users/account/route";
import { GET as readUpload } from "@/app/api/v1/uploads/[assetId]/route";
import {
  deletePrivateUploadObject,
  writePrivateUploadObject,
} from "@/lib/uploads/private-storage";

const storedKeys: string[] = [];
afterAll(async () => {
  for (const key of storedKeys) await deletePrivateUploadObject("local", key);
  await prisma.$disconnect();
});

async function storedAsset(userId: string, canvasId: string, size: number) {
  const storageKey = `uploads/${userId}/${randomBytes(8).toString("hex")}.txt`;
  await writePrivateUploadObject(
    "local",
    storageKey,
    Buffer.alloc(size, 1),
    "text/plain",
  );
  storedKeys.push(storageKey);
  return prisma.uploadAsset.create({
    data: {
      userId,
      canvasId,
      storageKey,
      storageMode: "local",
      filename: "a.txt",
      mimeType: "text/plain",
      size,
      status: UploadAssetStatus.ACTIVE,
    },
  });
}

describe("account deletion and uploads on other owners' canvases", () => {
  it("keeps uploads that back preserved items on a foreign canvas", async () => {
    const tag = randomBytes(6).toString("hex");
    const leaving = await prisma.user.create({
      data: { email: `leaving-${tag}@example.com` },
    });
    const owner = await prisma.user.create({
      data: { email: `owner-${tag}@example.com` },
    });
    await prisma.uploadQuota.createMany({
      data: [
        { userId: leaving.id, assetCount: 2, totalBytes: 30n },
        { userId: owner.id, assetCount: 1, totalBytes: 5n },
      ],
    });
    const foreignCanvas = await prisma.canvas.create({
      data: { name: "Owner's board", userId: owner.id },
    });
    const ownCanvas = await prisma.canvas.create({
      data: { name: "Leaving's board", userId: leaving.id },
    });
    await prisma.canvasShare.create({
      data: {
        canvasId: foreignCanvas.id,
        email: leaving.email,
        recipientId: leaving.id,
        role: "EDIT",
      },
    });
    const foreignAsset = await storedAsset(leaving.id, foreignCanvas.id, 10);
    const ownAsset = await storedAsset(leaving.id, ownCanvas.id, 20);
    await prisma.canvasItem.create({
      data: {
        canvasId: foreignCanvas.id,
        type: "IMAGE",
        positionX: 0,
        positionY: 0,
        width: 100,
        height: 100,
        zIndex: 1,
        content: { url: `/api/v1/uploads/${foreignAsset.id}` },
        createdById: leaving.id,
      },
    });

    authState.userId = leaving.id;
    authState.email = leaving.email;
    const response = await deleteAccount(
      new NextRequest("http://localhost/api/v1/users/account", {
        method: "DELETE",
        body: JSON.stringify({ password: "pw", confirmation: "DELETE" }),
      }),
    );
    expect(response.status).toBe(200);

    const kept = await prisma.uploadAsset.findUnique({
      where: { id: foreignAsset.id },
    });
    expect(kept).toMatchObject({ status: "ACTIVE", userId: owner.id });
    expect(
      await prisma.uploadAsset.findUnique({ where: { id: ownAsset.id } }),
    ).toBeNull();
    const ownJob = await prisma.outboxJob.findUnique({
      where: { dedupeKey: `upload.delete:${ownAsset.id}` },
    });
    expect(ownJob).not.toBeNull();
    expect(
      await prisma.outboxJob.findUnique({
        where: { dedupeKey: `upload.delete:${foreignAsset.id}` },
      }),
    ).toBeNull();
    const ownerQuota = await prisma.uploadQuota.findUniqueOrThrow({
      where: { userId: owner.id },
    });
    expect([ownerQuota.assetCount, ownerQuota.totalBytes]).toEqual([2, 15n]);

    sessionState.user = { id: owner.id, email: owner.email };
    const read = await readUpload(
      new NextRequest(`http://localhost/api/v1/uploads/${foreignAsset.id}`),
      { params: Promise.resolve({ assetId: foreignAsset.id }) },
    );
    expect(read.status).toBe(200);
    expect((await read.arrayBuffer()).byteLength).toBe(10);
  });

  it("queues deletion of collaborators' uploads on the deleted user's canvases", async () => {
    const tag = randomBytes(6).toString("hex");
    const leaving = await prisma.user.create({
      data: { email: `leaving-owner-${tag}@example.com` },
    });
    const collaborator = await prisma.user.create({
      data: { email: `collab-${tag}@example.com` },
    });
    await prisma.uploadQuota.createMany({
      data: [
        { userId: leaving.id, assetCount: 1, totalBytes: 4n },
        { userId: collaborator.id, assetCount: 2, totalBytes: 30n },
      ],
    });
    const board = await prisma.canvas.create({
      data: { name: "Leaving's shared board", userId: leaving.id },
    });
    await prisma.canvasShare.create({
      data: {
        canvasId: board.id,
        email: collaborator.email,
        recipientId: collaborator.id,
        role: "EDIT",
      },
    });
    const collabAsset = await storedAsset(collaborator.id, board.id, 10);
    const ownAsset = await storedAsset(leaving.id, board.id, 4);

    authState.userId = leaving.id;
    authState.email = leaving.email;
    const response = await deleteAccount(
      new NextRequest("http://localhost/api/v1/users/account", {
        method: "DELETE",
        body: JSON.stringify({ password: "pw", confirmation: "DELETE" }),
      }),
    );
    expect(response.status).toBe(200);

    for (const id of [collabAsset.id, ownAsset.id]) {
      const job = await prisma.outboxJob.findUnique({
        where: { dedupeKey: `upload.delete:${id}` },
      });
      expect(job?.payload).toMatchObject({ assetId: id, quotaReleased: true });
    }
    const quota = await prisma.uploadQuota.findUniqueOrThrow({
      where: { userId: collaborator.id },
    });
    expect([quota.assetCount, quota.totalBytes]).toEqual([1, 20n]);
  });
});
