import { NextResponse } from "next/server";
import { z } from "zod";
import { AccountExportStatus } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { requireAuth } from "@/lib/api/auth";
import { withApiHandler } from "@/lib/api/route-handler";
import { ConflictError, NotFoundError } from "@/lib/errors";
import { readPrivateUploadObject } from "@/lib/uploads/private-storage";

const paramsSchema = z.object({ exportId: z.string().cuid() });
type Context = { params: Promise<{ exportId: string }> };

export const GET = withApiHandler(async (_request, context: Context) => {
  const { userId } = await requireAuth();
  const { exportId } = paramsSchema.parse(await context.params);
  const exportRecord = await prisma.accountExport.findFirst({
    where: { id: exportId, userId },
  });
  if (!exportRecord) throw new NotFoundError("Account export not found");
  if (
    exportRecord.status !== AccountExportStatus.COMPLETED ||
    !exportRecord.storageKey ||
    !exportRecord.sha256
  ) {
    throw new ConflictError("Account export is not ready to download");
  }
  if (exportRecord.expiresAt <= new Date()) {
    throw new NotFoundError("Account export has expired");
  }
  const object = await readPrivateUploadObject(
    exportRecord.storageMode,
    exportRecord.storageKey,
  );
  return new NextResponse(object.body, {
    headers: {
      "Content-Type": "application/gzip",
      "X-Archive-Format": "memoria-jsonl-v2",
      "Content-Disposition": `attachment; filename="memoria-account-${exportRecord.createdAt.toISOString().slice(0, 10)}.jsonl.gz"`,
      "Cache-Control": "private, no-store",
      Digest: `sha-256=${Buffer.from(exportRecord.sha256, "hex").toString("base64")}`,
      "X-Content-SHA256": exportRecord.sha256,
      ...(object.contentLength
        ? { "Content-Length": String(object.contentLength) }
        : {}),
    },
  });
});
