import { NextResponse } from "next/server";
import { z } from "zod";
import { AccountExportStatus } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { requireAuth } from "@/lib/api/auth";
import { withApiHandler } from "@/lib/api/route-handler";
import { NotFoundError } from "@/lib/errors";
import { accountExportResponse } from "@/lib/account-export/response";
import { enqueueOutboxJob } from "@/lib/outbox/enqueue";

const paramsSchema = z.object({ exportId: z.string().cuid() });
type Context = { params: Promise<{ exportId: string }> };

export const GET = withApiHandler(async (_request, context: Context) => {
  const { userId } = await requireAuth();
  const { exportId } = paramsSchema.parse(await context.params);
  const exportRecord = await prisma.accountExport.findFirst({
    where: { id: exportId, userId },
  });
  if (!exportRecord) throw new NotFoundError("Account export not found");
  return NextResponse.json(accountExportResponse(exportRecord), {
    headers: { "Cache-Control": "private, no-store" },
  });
});

export const DELETE = withApiHandler(async (_request, context: Context) => {
  const { userId } = await requireAuth();
  const { exportId } = paramsSchema.parse(await context.params);
  const exportRecord = await prisma.$transaction(async (tx) => {
    const current = await tx.accountExport.findFirst({
      where: { id: exportId, userId },
    });
    if (!current) throw new NotFoundError("Account export not found");
    const updated = await tx.accountExport.update({
      where: { id: exportId },
      data: {
        cancelRequestedAt: new Date(),
        status:
          current.status === AccountExportStatus.EXPIRED
            ? AccountExportStatus.EXPIRED
            : AccountExportStatus.CANCELLED,
      },
    });
    if (current.storageKey) {
      await enqueueOutboxJob(tx, {
        type: "account-export.delete",
        dedupeKey: `account-export.cancel-delete:${exportId}`,
        payload: {
          exportId,
          storageMode: current.storageMode,
          storageKey: current.storageKey,
        },
      });
    }
    return updated;
  });
  return NextResponse.json(accountExportResponse(exportRecord), {
    headers: { "Cache-Control": "private, no-store" },
  });
});
