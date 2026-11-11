import { randomBytes } from "crypto";
import { afterAll, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
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
vi.mock("@/lib/auth/credentials", () => ({
  getCredentialPasswordHash: vi.fn(async () => "stored-hash"),
}));
vi.mock("@/lib/auth/password", () => ({
  verifyPassword: vi.fn(async () => true),
}));
const storage = vi.hoisted(() => ({ deleted: [] as string[] }));
vi.mock("@/lib/uploads/private-storage", () => ({
  deletePrivateUploadObject: vi.fn(async (_mode: string, key: string) => {
    storage.deleted.push(key);
  }),
  writePrivateUploadObject: vi.fn(async () => undefined),
}));

import { DELETE as deleteCanvas } from "@/app/api/v1/canvases/[canvasId]/route";
import { DELETE as deleteAccount } from "@/app/api/v1/users/account/route";
import { createThumbnailDeleteHandler } from "@/lib/thumbnails/outbox-handler";

afterAll(async () => {
  await prisma.$disconnect();
});

async function owner() {
  const user = await prisma.user.create({
    data: { email: `thumbs-${randomBytes(6).toString("hex")}@example.com` },
  });
  authState.userId = user.id;
  authState.email = user.email;
  return user;
}

async function canvasWithThumbnail(userId: string) {
  const canvas = await prisma.canvas.create({
    data: { name: "Thumb", userId },
  });
  const thumbnailKey = `thumbnails/${canvas.id}/7.png`;
  await prisma.canvas.update({
    where: { id: canvas.id },
    data: { thumbnailKey, thumbnailRevision: 7 },
  });
  return { canvas, thumbnailKey };
}

const thumbnailJob = (key: string) =>
  prisma.outboxJob.findUnique({
    where: { dedupeKey: `thumbnail.delete:${key}` },
  });

describe("thumbnail cleanup on deletion", () => {
  it("queues the canvas thumbnail when a canvas is deleted", async () => {
    const user = await owner();
    const { canvas, thumbnailKey } = await canvasWithThumbnail(user.id);
    const response = await deleteCanvas(
      new NextRequest(`http://localhost/api/v1/canvases/${canvas.id}`, {
        method: "DELETE",
      }),
      { params: Promise.resolve({ canvasId: canvas.id }) },
    );
    expect(response.status).toBe(200);
    const job = await thumbnailJob(thumbnailKey);
    expect(job).toMatchObject({
      type: "thumbnail.delete",
      payload: { storageKey: thumbnailKey },
    });
    // The job works without the canvas row.
    await createThumbnailDeleteHandler()(job!);
    expect(storage.deleted).toContain(thumbnailKey);
  });

  it("queues every canvas thumbnail when an account is deleted", async () => {
    const user = await owner();
    const first = await canvasWithThumbnail(user.id);
    const second = await canvasWithThumbnail(user.id);
    await prisma.canvas.create({ data: { name: "No thumb", userId: user.id } });
    const response = await deleteAccount(
      new NextRequest("http://localhost/api/v1/users/account", {
        method: "DELETE",
        body: JSON.stringify({ password: "pw", confirmation: "DELETE" }),
      }),
    );
    expect(response.status).toBe(200);
    for (const key of [first.thumbnailKey, second.thumbnailKey]) {
      expect(await thumbnailJob(key)).toMatchObject({
        payload: { storageKey: key },
      });
    }
  });
});
