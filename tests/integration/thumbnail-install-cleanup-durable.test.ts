import { randomBytes } from "crypto";
import { afterAll, describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "@/generated/prisma/client";

const storage = vi.hoisted(() => ({ deleted: [] as string[] }));
vi.mock("@/lib/uploads/private-storage", () => ({
  deletePrivateUploadObject: vi.fn(async (_mode: string, key: string) => {
    storage.deleted.push(key);
  }),
  writePrivateUploadObject: vi.fn(async () => undefined),
}));

import { prisma } from "@/lib/db";
import { createThumbnailStoreHandler } from "@/lib/thumbnails/outbox-handler";

afterAll(async () => {
  await prisma.$disconnect();
});

/** A client whose first outbox enqueue inside a transaction fails. */
function clientFailingFirstEnqueue(): PrismaClient {
  let failed = false;
  return new Proxy(prisma, {
    get(target, property, receiver) {
      if (property !== "$transaction")
        return Reflect.get(target, property, receiver);
      return (work: (tx: unknown) => Promise<unknown>, options?: unknown) =>
        target.$transaction(
          (tx) =>
            work(
              new Proxy(tx, {
                get(txTarget, txProperty, txReceiver) {
                  const value = Reflect.get(txTarget, txProperty, txReceiver);
                  if (txProperty !== "outboxJob" || failed) return value;
                  return new Proxy(value as object, {
                    get(model, method, modelReceiver) {
                      const fn = Reflect.get(model, method, modelReceiver);
                      if (method !== "upsert" && method !== "create") return fn;
                      return async () => {
                        failed = true;
                        throw new Error("enqueue failed");
                      };
                    },
                  });
                },
              }),
            ),
          options as never,
        );
    },
  }) as PrismaClient;
}

async function seed(installedRevision: bigint | null) {
  const user = await prisma.user.create({
    data: {
      email: `thumb-durable-${randomBytes(6).toString("hex")}@example.com`,
    },
  });
  const canvas = await prisma.canvas.create({
    data: { name: "Durable", userId: user.id },
  });
  const event = await prisma.canvasEvent.create({
    data: {
      canvasId: canvas.id,
      actorId: user.id,
      entityId: canvas.id,
      entityVersion: 1,
      operation: "canvas.update",
    },
  });
  const oldKey = `thumbnails/${canvas.id}/old.png`;
  await prisma.canvas.update({
    where: { id: canvas.id },
    data: {
      thumbnailKey: oldKey,
      thumbnailRevision: installedRevision ?? 0n,
    },
  });
  const candidate = await prisma.canvasThumbnailCandidate.create({
    data: {
      canvasId: canvas.id,
      revision: event.sequence,
      mimeType: "image/png",
      bytes: Buffer.from([1, 2, 3]),
    },
  });
  return {
    canvas,
    candidate,
    oldKey,
    newKey: `thumbnails/${canvas.id}/${event.sequence}.png`,
  };
}

const job = (candidateId: string) => ({ payload: { candidateId } }) as never;
const deletionJob = (key: string) =>
  prisma.outboxJob.findUnique({
    where: { dedupeKey: `thumbnail.delete:${key}` },
  });

describe("thumbnail install cleanup is durable", () => {
  it("keeps the candidate when queueing the old key's deletion fails, and a retry completes", async () => {
    const { canvas, candidate, oldKey, newKey } = await seed(null);

    await expect(
      createThumbnailStoreHandler(clientFailingFirstEnqueue())(
        job(candidate.id),
        undefined as never,
      ),
    ).rejects.toThrow("enqueue failed");
    expect(
      await prisma.canvasThumbnailCandidate.findUnique({
        where: { id: candidate.id },
      }),
    ).not.toBeNull();

    await createThumbnailStoreHandler(prisma)(
      job(candidate.id),
      undefined as never,
    );
    expect(
      await prisma.canvas.findUniqueOrThrow({
        where: { id: canvas.id },
        select: { thumbnailKey: true },
      }),
    ).toEqual({ thumbnailKey: newKey });
    expect(await deletionJob(oldKey)).toMatchObject({
      type: "thumbnail.delete",
      payload: { storageKey: oldKey },
    });
  });

  it("queues the freshly written object when a newer thumbnail is already installed", async () => {
    const { canvas, candidate, oldKey, newKey } = await seed(9_000_000_000n);
    storage.deleted.length = 0;

    await createThumbnailStoreHandler(prisma)(
      job(candidate.id),
      undefined as never,
    );

    expect(
      await prisma.canvas.findUniqueOrThrow({
        where: { id: canvas.id },
        select: { thumbnailKey: true },
      }),
    ).toEqual({ thumbnailKey: oldKey });
    expect(await deletionJob(newKey)).toMatchObject({
      payload: { storageKey: newKey },
    });
    expect(await deletionJob(oldKey)).toBeNull();
    expect(storage.deleted).toEqual([]);
  });
});
