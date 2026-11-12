import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAuth } from "@/lib/api/auth";
import { withApiHandler } from "@/lib/api/route-handler";
import { prisma } from "@/lib/db";
import { NotFoundError } from "@/lib/errors";

interface RouteContext {
  params: Promise<{ itemId: string }>;
}

const paramsSchema = z.object({ itemId: z.string().min(1).max(64) });

/**
 * IMP-070 — records that the owner opened a saved link, so the weekly recap
 * does not call it stale. "Something old" (IMP-097) records opens of any of
 * the owner's items, so it does not offer the same one again. Only the timestamp changes: no version bump, no
 * edit time and no collaboration event, because nothing on the board moved.
 */
export const POST = withApiHandler(
  async (_request: Request, { params }: RouteContext) => {
    const { userId } = await requireAuth();
    const { itemId } = paramsSchema.parse(await params);
    const updated = await prisma.$executeRaw`
      UPDATE "CanvasItem" AS item
      SET "lastOpenedAt" = NOW()
      FROM "Canvas" AS canvas
      WHERE item."id" = ${itemId}
        AND item."deletedAt" IS NULL
        AND canvas."id" = item."canvasId"
        AND canvas."userId" = ${userId}
    `;
    if (updated === 0) throw new NotFoundError("Item not found.");
    return new NextResponse(null, { status: 204 });
  },
);
