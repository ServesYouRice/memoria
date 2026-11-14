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
  // A video card also matches words found only in its transcript (IMP-114).
  const rows = await prisma.$queryRaw<Array<{ id: string }>>(Prisma.sql`
    SELECT "id" FROM "CanvasItem"
    WHERE "canvasId" = ${canvasId}
      AND "deletedAt" IS NULL
      AND "type" <> 'POLL'::"ItemType"
      AND ("content"::text ILIKE ${pattern} ESCAPE '\\'
        OR array_to_string("tags", ' ') ILIKE ${pattern} ESCAPE '\\'
        -- A PDF card also matches words inside its file (IMP-113).
        OR ("type" = 'PDF'::"ItemType" AND EXISTS (
          SELECT 1 FROM "ItemPageCopy" p
          WHERE p."itemId" = "CanvasItem"."id"
            AND p."searchVector" @@ plainto_tsquery('english', ${q})
        ))
        OR EXISTS (
          SELECT 1 FROM "ItemTranscript" t
          WHERE t."itemId" = "CanvasItem"."id"
            AND t."text" ILIKE ${pattern} ESCAPE '\\'
        ))
    ORDER BY "zIndex" ASC, "id" ASC
    LIMIT ${LAUNCH_LIMITS.itemsPerCanvas}
  `);

  return NextResponse.json(
    { itemIds: rows.map((row) => row.id) },
    { headers: { "Cache-Control": "private, no-store" } },
  );
});
