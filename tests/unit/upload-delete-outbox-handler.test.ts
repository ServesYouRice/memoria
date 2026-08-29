import { describe, expect, it, vi } from "vitest";

const deleteObject = vi.hoisted(() => vi.fn());
vi.mock("@/lib/uploads/private-storage", () => ({
  deletePrivateUploadObject: deleteObject,
}));

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

  it("rolls back instead of silently losing quota accounting", async () => {
    const tx = {
      uploadAsset: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
      uploadQuota: { updateMany: vi.fn().mockResolvedValue({ count: 0 }) },
    };
    const prisma = {
      $transaction: vi.fn(async (run) => run(tx)),
    } as never;
    const handler = createUploadDeleteHandler(prisma);

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
    ).rejects.toThrow("Upload quota invariant");
  });
});
