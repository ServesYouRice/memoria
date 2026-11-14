import { randomBytes } from "crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/db";
import type { OutboxJob } from "@/lib/outbox/types";
import { createTrashRetentionHandler } from "@/lib/retention/outbox-handler";
import {
  PAGE_CAPTURE_BUDGET,
  PAGE_CAPTURE_JOB,
  createPageCaptureHandler,
  enqueuePageCapture,
  sweepOrphanPageCaptures,
} from "@/lib/services/page-capture";

beforeAll(() => {
  vi.stubEnv("PAGE_CAPTURE", "true");
  vi.stubEnv("UPLOAD_STORAGE", "local");
});

afterAll(async () => {
  vi.unstubAllEnvs();
  await prisma.$disconnect();
});

const allowed = async (url: string) => ({
  valid: true,
  pinnedIp: "93.184.216.34",
  targetUrl: new URL(url),
});

async function fixture() {
  const tag = randomBytes(6).toString("hex");
  const user = await prisma.user.create({
    data: { email: `page-capture-${tag}@example.com` },
  });
  const canvas = await prisma.canvas.create({
    data: { name: "Reading", userId: user.id },
  });
  const url = `https://news.example/${tag}`;
  const link = await prisma.canvasItem.create({
    data: {
      canvasId: canvas.id,
      type: "BOOKMARK",
      positionX: 0,
      positionY: 0,
      width: 300,
      height: 100,
      content: { url, title: "A story" },
      createdById: user.id,
    },
  });
  return { tag, user, canvas, link, url };
}

// Capture ids name stored files, so each run of this suite uses its own.
const RUN = randomBytes(4).toString("hex");

function job(itemId: string, name: string): OutboxJob {
  const captureId = `${name}-${RUN}`;
  return {
    id: `job-${captureId}`,
    type: PAGE_CAPTURE_JOB,
    payload: { itemId, captureId },
    attempts: 1,
    maxAttempts: 3,
  } as OutboxJob;
}

const pictures = (size = 2_000) => ({
  image: Buffer.alloc(size, 1),
  pdf: Buffer.alloc(size * 2, 2),
});

describe("page capture (IMP-110)", () => {
  it("keeps a picture and a PDF, charges the quota, and is safe to run twice", async () => {
    const { user, link, url } = await fixture();
    const write = vi.fn(async () => undefined);
    const capture = vi.fn(async () => pictures());
    const handler = createPageCaptureHandler(prisma, {
      capture,
      validateUrl: allowed,
      storage: { write },
    });

    await handler(job(link.id, "capture-a"));
    await handler(job(link.id, "capture-a"));

    expect(capture).toHaveBeenCalledTimes(1);
    expect(write).toHaveBeenCalledTimes(2);
    const row = await prisma.itemPageCapture.findUniqueOrThrow({
      where: { itemId: link.id },
    });
    expect(row.url).toBe(url);
    expect(row.userId).toBe(user.id);
    const assets = await prisma.uploadAsset.findMany({
      where: { sourceItemId: link.id },
      orderBy: { size: "asc" },
    });
    expect(assets.map((asset) => [asset.mimeType, asset.status])).toEqual([
      ["image/jpeg", "ACTIVE"],
      ["application/pdf", "ACTIVE"],
    ]);
    // Owned by the person, so the account export (which walks the account's
    // uploads) includes them and the account deletion removes them.
    expect(assets.every((asset) => asset.userId === user.id)).toBe(true);
    expect(row.imageAssetId).toBe(assets[0]!.id);
    expect(row.pdfAssetId).toBe(assets[1]!.id);
    const quota = await prisma.uploadQuota.findUniqueOrThrow({
      where: { userId: user.id },
    });
    expect(quota.assetCount).toBe(2);
    expect(Number(quota.totalBytes)).toBe(6_000);
  });

  it("resumes a reservation an earlier try left behind without charging twice", async () => {
    const { user, link } = await fixture();
    let fail = true;
    const write = vi.fn(async () => {
      if (fail) throw new Error("storage down");
    });
    const handler = createPageCaptureHandler(prisma, {
      capture: async () => pictures(),
      validateUrl: allowed,
      storage: { write },
    });
    await expect(handler(job(link.id, "capture-b"))).rejects.toThrow(
      "storage down",
    );
    fail = false;
    await handler(job(link.id, "capture-b"));

    const quota = await prisma.uploadQuota.findUniqueOrThrow({
      where: { userId: user.id },
    });
    expect(quota.assetCount).toBe(2);
    expect(Number(quota.totalBytes)).toBe(6_000);
    expect(
      await prisma.uploadAsset.count({
        where: { sourceItemId: link.id, status: "ACTIVE" },
      }),
    ).toBe(2);
  });

  it("stops at half the account's storage, so uploads keep their room", async () => {
    const { user, link } = await fixture();
    await prisma.uploadQuota.create({
      data: {
        userId: user.id,
        assetCount: 0,
        totalBytes: BigInt(PAGE_CAPTURE_BUDGET.maxBytesPerAccount),
      },
    });
    const write = vi.fn(async () => undefined);
    await createPageCaptureHandler(prisma, {
      capture: async () => pictures(),
      validateUrl: allowed,
      storage: { write },
    })(job(link.id, "capture-c"));
    expect(write).not.toHaveBeenCalled();
    expect(
      await prisma.itemPageCapture.findUnique({ where: { itemId: link.id } }),
    ).toBeNull();
  });

  it("refuses a link that points at an internal address", async () => {
    const { user, canvas } = await fixture();
    const internal = await prisma.canvasItem.create({
      data: {
        canvasId: canvas.id,
        type: "BOOKMARK",
        positionX: 0,
        positionY: 0,
        width: 300,
        height: 100,
        content: { url: "http://169.254.169.254/latest/meta-data/" },
        createdById: user.id,
      },
    });
    const capture = vi.fn(async () => pictures());
    await createPageCaptureHandler(prisma, {
      capture,
      storage: { write: vi.fn() },
    })(job(internal.id, "capture-d"));
    expect(capture).not.toHaveBeenCalled();
    expect(
      await prisma.uploadAsset.count({ where: { sourceItemId: internal.id } }),
    ).toBe(0);
  });

  it("deletes the files with the item and releases their quota", async () => {
    const { user, link } = await fixture();
    await createPageCaptureHandler(prisma, {
      capture: async () => pictures(),
      validateUrl: allowed,
      storage: { write: vi.fn(async () => undefined) },
    })(job(link.id, "capture-e"));
    const assets = await prisma.uploadAsset.findMany({
      where: { sourceItemId: link.id },
    });
    expect(assets).toHaveLength(2);

    // Soft delete (the trash): the files stay, so the link can be restored.
    await prisma.canvasItem.update({
      where: { id: link.id },
      data: { deletedAt: new Date() },
    });
    await sweepOrphanPageCaptures(prisma, 500);
    expect(
      await prisma.uploadAsset.count({
        where: { sourceItemId: link.id, status: "ACTIVE" },
      }),
    ).toBe(2);

    // Permanent deletion (trash retention): the capture row cascades away and
    // the sweep queues deletion of the files.
    await prisma.canvasItem.delete({ where: { id: link.id } });
    expect(
      await prisma.itemPageCapture.findUnique({ where: { itemId: link.id } }),
    ).toBeNull();
    expect(await sweepOrphanPageCaptures(prisma, 500)).toBeGreaterThanOrEqual(
      2,
    );
    expect(
      await prisma.uploadAsset.count({
        where: { sourceItemId: link.id, status: "DELETING" },
      }),
    ).toBe(2);
    const quota = await prisma.uploadQuota.findUniqueOrThrow({
      where: { userId: user.id },
    });
    expect(quota.assetCount).toBe(0);
    expect(Number(quota.totalBytes)).toBe(0);
    const jobs = await prisma.outboxJob.count({
      where: {
        type: "upload.delete",
        dedupeKey: { in: assets.map((asset) => `upload.delete:${asset.id}`) },
      },
    });
    expect(jobs).toBe(2);
    // Running the sweep again finds nothing more to do.
    await sweepOrphanPageCaptures(prisma, 500);
    expect(
      Number(
        (
          await prisma.uploadQuota.findUniqueOrThrow({
            where: { userId: user.id },
          })
        ).totalBytes,
      ),
    ).toBe(0);
  });

  it("is removed by trash retention when its link is deleted for good", async () => {
    const { link } = await fixture();
    await createPageCaptureHandler(prisma, {
      capture: async () => pictures(),
      validateUrl: allowed,
      storage: { write: vi.fn(async () => undefined) },
    })(job(link.id, "capture-f"));
    await prisma.canvasItem.update({
      where: { id: link.id },
      data: { deletedAt: new Date(Date.now() - 400 * 86_400_000) },
    });
    await createTrashRetentionHandler(prisma)({
      id: "retention-job",
      type: "retention.trash",
      payload: {},
      attempts: 1,
      maxAttempts: 3,
    } as OutboxJob);
    expect(
      await prisma.canvasItem.findUnique({ where: { id: link.id } }),
    ).toBeNull();
    expect(
      await prisma.uploadAsset.count({
        where: { sourceItemId: link.id, status: "DELETING" },
      }),
    ).toBe(2);
  });

  it("queues one job per link and address, and only when it is on", async () => {
    const { link, url } = await fixture();
    await prisma.$transaction(async (tx) => {
      await enqueuePageCapture(tx, { itemId: link.id, url });
      await enqueuePageCapture(tx, { itemId: link.id, url });
    });
    expect(
      await prisma.outboxJob.count({
        where: {
          type: PAGE_CAPTURE_JOB,
          payload: { path: ["itemId"], equals: link.id },
        },
      }),
    ).toBe(1);

    vi.stubEnv("PAGE_CAPTURE", "false");
    const other = await fixture();
    await enqueuePageCapture(prisma, { itemId: other.link.id, url: other.url });
    vi.stubEnv("PAGE_CAPTURE", "true");
    expect(
      await prisma.outboxJob.count({
        where: {
          type: PAGE_CAPTURE_JOB,
          payload: { path: ["itemId"], equals: other.link.id },
        },
      }),
    ).toBe(0);
  });
});
