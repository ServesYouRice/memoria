import { describe, expect, it, vi } from "vitest";

const deleteObject = vi.hoisted(() => vi.fn());
vi.mock("@/lib/uploads/private-storage", () => ({
  deletePrivateUploadObject: deleteObject,
}));

const logger = vi.hoisted(() => ({
  error: vi.fn(),
  warn: vi.fn(),
  info: vi.fn(),
  debug: vi.fn(),
}));
vi.mock("@/lib/logger", () => ({ createLogger: () => logger }));

import { createUploadDeleteHandler } from "@/lib/uploads/outbox-handler";

describe("idempotent upload deletion delivery", () => {
  it("releases quota only when it transitions DELETING to DELETED", async () => {
    const updateAsset = vi
      .fn()
      .mockResolvedValueOnce({ count: 1 })
      .mockResolvedValueOnce({ count: 0 });
    const updateQuota = vi.fn().mockResolvedValue({ count: 1 });
    const tx = {
      uploadAsset: { updateMany: updateAsset },
      uploadQuota: { updateMany: updateQuota },
    };
    const prisma = {
      $transaction: vi.fn(async (run) => run(tx)),
    } as never;
    const handler = createUploadDeleteHandler(prisma);
    const job = {
      payload: {
        assetId: "asset-1",
        userId: "user-1",
        storageMode: "s3",
        storageKey: "uploads/object.png",
        size: 42,
      },
    } as never;

    await handler(job);
    await handler(job);

    expect(deleteObject).toHaveBeenCalledTimes(2);
    expect(updateAsset).toHaveBeenCalledWith({
      where: { id: "asset-1", status: "DELETING" },
      data: { status: "DELETED" },
    });
    expect(updateQuota).toHaveBeenCalledTimes(1);
  });

  it("logs a failed quota guard instead of retrying it until DEAD", async () => {
    const tx = {
      uploadAsset: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
      uploadQuota: { updateMany: vi.fn().mockResolvedValue({ count: 0 }) },
    };
    const prisma = {
      $transaction: vi.fn(async (run) => run(tx)),
    } as never;
    const handler = createUploadDeleteHandler(prisma);

    // A retry reads the same quota row, so it cannot succeed: the job must
    // finish (the object is gone) rather than throw.
    await expect(
      handler({
        payload: {
          assetId: "asset-1",
          userId: "user-1",
          storageMode: "s3",
          storageKey: "uploads/object.png",
          size: 42,
        },
      } as never),
    ).resolves.toBeUndefined();
    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({ assetId: "asset-1", userId: "user-1" }),
      expect.stringContaining("quota"),
    );
  });

  it("never decrements again for a job whose enqueue released the quota", async () => {
    for (const count of [0, 1]) {
      const updateAsset = vi.fn().mockResolvedValue({ count });
      const updateQuota = vi.fn().mockResolvedValue({ count: 1 });
      const tx = {
        uploadAsset: { updateMany: updateAsset },
        uploadQuota: { updateMany: updateQuota },
      };
      const prisma = {
        $transaction: vi.fn(async (run) => run(tx)),
      } as never;
      deleteObject.mockClear();
      await createUploadDeleteHandler(prisma)({
        payload: {
          assetId: "asset-2",
          userId: "user-1",
          storageMode: "s3",
          storageKey: "uploads/flagged.png",
          size: 42,
          quotaReleased: true,
        },
      } as never);
      // The object is deleted whether or not the row still exists.
      expect(deleteObject).toHaveBeenCalledWith(
        "s3",
        "uploads/flagged.png",
        undefined,
      );
      expect(updateAsset).toHaveBeenCalledWith({
        where: { id: "asset-2", status: "DELETING" },
        data: { status: "DELETED" },
      });
      expect(updateQuota).not.toHaveBeenCalled();
    }
  });
});
