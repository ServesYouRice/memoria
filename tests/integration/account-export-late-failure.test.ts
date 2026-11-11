import { randomBytes } from "crypto";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

const storage = vi.hoisted(() => ({
  /** Runs while the archive upload is in flight, then the upload fails. */
  during: null as null | ((exportId: string) => Promise<void>),
}));

vi.mock("@/lib/uploads/private-storage", () => ({
  writePrivateUploadStream: vi.fn(
    async (_mode: string, key: string, body: NodeJS.ReadableStream) => {
      for await (const chunk of body) void chunk;
      const exportId = key.split("/").find((part) => part.startsWith("c"));
      if (storage.during) await storage.during(exportId ?? "");
      throw new Error("storage unavailable");
    },
  ),
  readPrivateUploadObject: vi.fn(),
  deletePrivateUploadObject: vi.fn(async () => undefined),
}));

import { prisma } from "@/lib/db";
import { AccountExportStatus } from "@/generated/prisma/client";
import { createAccountExportBuildHandler } from "@/lib/account-export/outbox-handler";

afterAll(async () => {
  await prisma.$disconnect();
});
beforeEach(() => {
  storage.during = null;
});

async function seedExport() {
  const user = await prisma.user.create({
    data: { email: `export-${randomBytes(6).toString("hex")}@example.com` },
  });
  const accountExport = await prisma.accountExport.create({
    data: {
      userId: user.id,
      storageMode: "local",
      expiresAt: new Date(Date.now() + 86_400_000),
    },
  });
  return accountExport;
}

function buildJob(exportId: string, attempts = 1) {
  return {
    id: `job-${randomBytes(4).toString("hex")}`,
    type: "account-export.build",
    payload: { exportId },
    attempts,
    maxAttempts: 3,
  } as never;
}

async function runBuild(exportId: string, attempts = 1) {
  await createAccountExportBuildHandler(prisma)(
    buildJob(exportId, attempts),
  ).then(
    () => null,
    (error: unknown) => error,
  );
  return prisma.accountExport.findUniqueOrThrow({ where: { id: exportId } });
}

describe("account export late failures (PostgreSQL)", () => {
  it("keeps a cancellation made while the upload was failing", async () => {
    const { id } = await seedExport();
    storage.during = async () => {
      // What the DELETE route does.
      await prisma.accountExport.update({
        where: { id },
        data: {
          status: AccountExportStatus.CANCELLED,
          cancelRequestedAt: new Date(),
        },
      });
    };

    const row = await runBuild(id);

    expect(row.status).toBe(AccountExportStatus.CANCELLED);
  });

  it("keeps another attempt's completion", async () => {
    const { id } = await seedExport();
    storage.during = async () => {
      await prisma.accountExport.update({
        where: { id },
        data: {
          status: AccountExportStatus.COMPLETED,
          completedAt: new Date(),
          startedAt: new Date(Date.now() + 5_000),
        },
      });
    };

    const row = await runBuild(id);

    expect(row.status).toBe(AccountExportStatus.COMPLETED);
    expect(row.lastError).toBeNull();
  });

  it("keeps a newer attempt that took the export over", async () => {
    const { id } = await seedExport();
    const takeover = new Date(Date.now() + 5_000);
    storage.during = async () => {
      await prisma.accountExport.update({
        where: { id },
        data: { status: AccountExportStatus.RUNNING, startedAt: takeover },
      });
    };

    const row = await runBuild(id);

    expect(row.status).toBe(AccountExportStatus.RUNNING);
    expect(row.startedAt?.toISOString()).toBe(takeover.toISOString());
    expect(row.lastError).toBeNull();
  });

  it("records the owning attempt's failure as retryable, then terminal", async () => {
    const { id } = await seedExport();

    const retry = await runBuild(id, 1);
    expect(retry.status).toBe(AccountExportStatus.QUEUED);
    expect(retry.lastError).toBe("storage unavailable");

    const final = await runBuild(id, 3);
    expect(final.status).toBe(AccountExportStatus.FAILED);
    expect(final.lastError).toBe("storage unavailable");
  });
});
