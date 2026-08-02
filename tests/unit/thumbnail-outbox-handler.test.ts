import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "@/generated/prisma/client";

const { writeObject, deleteObject } = vi.hoisted(() => ({
  writeObject: vi.fn(),
  deleteObject: vi.fn(),
}));

vi.mock("@/lib/uploads/private-storage", () => ({
  writePrivateUploadObject: writeObject,
  deletePrivateUploadObject: deleteObject,
}));

import { createThumbnailStoreHandler } from "@/lib/thumbnails/outbox-handler";

function fakePrisma(currentRevision: bigint, oldKey: string | null = null) {
  const candidate = {
    id: "clzzzzzzzzzzzzzzzzzzzzzzz",
    canvasId: "clxxxxxxxxxxxxxxxxxxxxxxx",
    revision: 4n,
    mimeType: "image/png",
    bytes: Buffer.from("png"),
    createdAt: new Date(),
  };
  const candidateDelete = vi.fn();
  const canvasUpdate = vi.fn();
  const client = {
    canvasThumbnailCandidate: {
      findUnique: vi.fn().mockResolvedValue(candidate),
      delete: candidateDelete,
    },
    canvas: {
      findUnique: vi.fn().mockResolvedValue({ thumbnailKey: oldKey }),
      update: canvasUpdate,
    },
    $queryRaw: vi.fn().mockResolvedValue([{ revision: currentRevision }]),
    $transaction: vi.fn(async (callback: (tx: unknown) => unknown) =>
      callback(client),
    ),
  };
  return {
    client: client as unknown as PrismaClient,
    candidateDelete,
    canvasUpdate,
  };
}

describe("thumbnail outbox handler", () => {
  beforeEach(() => vi.clearAllMocks());

  it("stores the candidate with a truthful extension and MIME type", async () => {
    const { client, canvasUpdate } = fakePrisma(4n);
    await createThumbnailStoreHandler(client)({
      payload: { candidateId: "clzzzzzzzzzzzzzzzzzzzzzzz" },
    } as never);
    expect(writeObject).toHaveBeenCalledWith(
      expect.any(String),
      "thumbnails/clxxxxxxxxxxxxxxxxxxxxxxx/4.png",
      Buffer.from("png"),
      "image/png",
    );
    expect(canvasUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          thumbnailKey: "thumbnails/clxxxxxxxxxxxxxxxxxxxxxxx/4.png",
          thumbnailRevision: 4n,
        }),
      }),
    );
  });

  it("drops a stale candidate without writing an object", async () => {
    const { client, candidateDelete } = fakePrisma(5n);
    await createThumbnailStoreHandler(client)({
      payload: { candidateId: "clzzzzzzzzzzzzzzzzzzzzzzz" },
    } as never);
    expect(candidateDelete).toHaveBeenCalled();
    expect(writeObject).not.toHaveBeenCalled();
  });
});
