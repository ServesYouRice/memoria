import { NextResponse } from "next/server";
import { AccountExportStatus } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { requireAuth } from "@/lib/api/auth";
import { withApiHandler } from "@/lib/api/route-handler";
import { enqueueOutboxJob } from "@/lib/outbox/enqueue";
import {
  ACCOUNT_EXPORT_FORMAT_VERSION,
  ACCOUNT_EXPORT_RETENTION_MS,
} from "@/lib/account-export/constants";
import { accountExportResponse } from "@/lib/account-export/response";

export const GET = withApiHandler(async () => {
  const { userId } = await requireAuth();
  const exports = await prisma.accountExport.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
    take: 10,
  });
  return NextResponse.json(
    { exports: exports.map(accountExportResponse) },
    { headers: { "Cache-Control": "private, no-store" } },
  );
});

export const POST = withApiHandler(async () => {
  const { userId } = await requireAuth();
  const exportRecord = await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`
      SELECT pg_advisory_xact_lock(hashtextextended(${userId}, 0))
    `;
    const active = await tx.accountExport.findFirst({
      where: {
        userId,
        status: {
          in: [AccountExportStatus.QUEUED, AccountExportStatus.RUNNING],
        },
      },
      orderBy: { createdAt: "desc" },
    });
    if (active) return active;
    const created = await tx.accountExport.create({
      data: {
        userId,
        status: AccountExportStatus.QUEUED,
        formatVersion: ACCOUNT_EXPORT_FORMAT_VERSION,
        storageMode: process.env.UPLOAD_STORAGE || "local",
        expiresAt: new Date(Date.now() + ACCOUNT_EXPORT_RETENTION_MS),
      },
    });
    await enqueueOutboxJob(tx, {
      type: "account-export.build",
      dedupeKey: `account-export.build:${created.id}`,
      payload: { exportId: created.id },
      maxAttempts: 3,
    });
    return created;
  });

  return NextResponse.json(accountExportResponse(exportRecord), {
    status: 202,
    headers: { "Cache-Control": "private, no-store" },
  });
});
