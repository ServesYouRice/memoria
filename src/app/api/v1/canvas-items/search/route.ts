import { NextResponse } from "next/server";
import { Prisma } from "@/generated/prisma/client";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { requireAuth, requireCanvasAccess } from "@/lib/api/auth";
import { withApiHandler } from "@/lib/api/route-handler";
import { LAUNCH_LIMITS } from "@/lib/policy/launch-limits";

const querySchema = z.object({
  canvasId: z.string().cuid(),
  q: z.string().trim().min(1).max(200),
});

export const GET = withApiHandler(async (request: Request) => {
  const { userId, email } = await requireAuth();
  const { canvasId, q } = querySchema.parse(
    Object.fromEntries(new URL(request.url).searchParams),
  );
  await requireCanvasAccess(canvasId, userId, email, "VIEW");

  const pattern = `%${q.replaceAll("%", "\\%").replaceAll("_", "\\_")}%`;
  const rows = await prisma.$queryRaw<Array<{ id: string }>>(Prisma.sql`
    SELECT "id" FROM "CanvasItem"
    WHERE "canvasId" = ${canvasId}
      AND "deletedAt" IS NULL
      AND "type" <> 'POLL'::"ItemType"
      AND ("content"::text ILIKE ${pattern} ESCAPE '\\'
        OR array_to_string("tags", ' ') ILIKE ${pattern} ESCAPE '\\')
    ORDER BY "zIndex" ASC, "id" ASC
    LIMIT ${LAUNCH_LIMITS.itemsPerCanvas}
  `);

  return NextResponse.json(
    { itemIds: rows.map((row) => row.id) },
    { headers: { "Cache-Control": "private, no-store" } },
  );
});
