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

async function addEvent(canvasId: string, actorId: string) {
  const event = await prisma.canvasEvent.create({
    data: {
      canvasId,
      actorId,
      entityId: canvasId,
      entityVersion: 1,
      operation: "canvas.update",
    },
  });
  return event.sequence;
}

/**
 * A client whose install transaction runs `between` right after it reads the
 * canvas's latest event revision, giving `between` up to `waitMs` to finish
 * before the transaction goes on (it may be blocked by a row lock).
 */
function clientPausingAfterRevisionRead(
  between: () => Promise<void>,
  waitMs: number,
): { client: PrismaClient; done: () => Promise<void> } {
  let pending: Promise<void> = Promise.resolve();
  let fired = false;
  const client = new Proxy(prisma, {
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
                  if (txProperty !== "$queryRaw") return value;
                  return async (
                    strings: TemplateStringsArray,
                    ...values: unknown[]
                  ) => {
                    const rows = await (
                      value as (...args: unknown[]) => Promise<unknown>
                    ).call(txTarget, strings, ...values);
                    if (!fired && strings.join("?").includes('"CanvasEvent"')) {
                      fired = true;
                      pending = between();
                      await Promise.race([
                        pending,
                        new Promise((resolve) => setTimeout(resolve, waitMs)),
                      ]);
                    }
                    return rows;
                  };
                },
              }),
            ),
          options as never,
        );
    },
  }) as PrismaClient;
  return { client, done: () => pending };
}

describe("thumbnail install race", () => {
  it("never downgrades a newer thumbnail installed while an older install runs", async () => {
    const user = await prisma.user.create({
      data: {
        email: `thumb-race-${randomBytes(6).toString("hex")}@example.com`,
      },
    });
    const canvas = await prisma.canvas.create({
      data: { name: "Race", userId: user.id },
    });
    const olderRevision = await addEvent(canvas.id, user.id);
    const candidate = await prisma.canvasThumbnailCandidate.create({
      data: {
        canvasId: canvas.id,
        revision: olderRevision,
        mimeType: "image/png",
        bytes: Buffer.from([1, 2, 3]),
      },
    });
    let newerKey = "";
    let newerRevision = 0n;

    // While the older install is between its revision check and its write, a
    // mutation lands and a newer thumbnail is installed.
    const { client, done } = clientPausingAfterRevisionRead(async () => {
      newerRevision = await addEvent(canvas.id, user.id);
      newerKey = `thumbnails/${canvas.id}/${newerRevision}.png`;
      await prisma.canvas.update({
        where: { id: canvas.id },
        data: { thumbnailKey: newerKey, thumbnailRevision: newerRevision },
      });
    }, 1_000);

    await createThumbnailStoreHandler(client)(
      { payload: { candidateId: candidate.id } } as never,
      undefined as never,
    );
    await done();

    const row = await prisma.canvas.findUniqueOrThrow({
      where: { id: canvas.id },
      select: { thumbnailKey: true, thumbnailRevision: true },
    });
    expect(row).toEqual({
      thumbnailKey: newerKey,
      thumbnailRevision: newerRevision,
    });
    expect(
      await prisma.outboxJob.findUnique({
        where: { dedupeKey: `thumbnail.delete:${newerKey}` },
      }),
    ).toBeNull();
  });
});
