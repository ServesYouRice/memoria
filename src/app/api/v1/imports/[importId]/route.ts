import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { requireAuth } from "@/lib/api/auth";
import { withApiHandler } from "@/lib/api/route-handler";
import { NotFoundError } from "@/lib/errors";
import { bookmarkImportResponse } from "@/lib/import/bookmark-import";

const paramsSchema = z.object({ importId: z.string().cuid() });
type Context = { params: Promise<{ importId: string }> };

/** Progress of one bookmark import (IMP-091). */
export const GET = withApiHandler(async (_request, context: Context) => {
  const { userId } = await requireAuth();
  const { importId } = paramsSchema.parse(await context.params);
  const record = await prisma.bookmarkImport.findFirst({
    where: { id: importId, userId },
  });
  if (!record) throw new NotFoundError("Import not found");
  return NextResponse.json(bookmarkImportResponse(record), {
    headers: { "Cache-Control": "private, no-store" },
  });
});
