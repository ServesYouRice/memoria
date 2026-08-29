import { NextResponse } from "next/server";
import { Prisma } from "@/generated/prisma/client";
import { z } from "zod";
import { requireAuth, requireCanvasAccess } from "@/lib/api/auth";
import { withApiHandler } from "@/lib/api/route-handler";
import { prisma } from "@/lib/db";

const querySchema = z.object({ canvasId: z.string().cuid() });

export const GET = withApiHandler(async (request: Request) => {
  const { userId, email } = await requireAuth();
  const { canvasId } = querySchema.parse(
    Object.fromEntries(new URL(request.url).searchParams),
  );
  await requireCanvasAccess(canvasId, userId, email, "VIEW");
  const [summary, types, tags, revisionRows] = await Promise.all([
    prisma.$queryRaw<
      Array<{
        count: bigint;
        minX: number | null;
        minY: number | null;
        maxX: number | null;
        maxY: number | null;
      }>
    >`
      SELECT COUNT(*) AS count, MIN("positionX") AS "minX", MIN("positionY") AS "minY",
        MAX("positionX" + "width") AS "maxX", MAX("positionY" + "height") AS "maxY"
      FROM "CanvasItem"
      WHERE "canvasId" = ${canvasId}
        AND "deletedAt" IS NULL
        AND "type" <> 'POLL'::"ItemType"
    `,
    prisma.canvasItem.groupBy({
      by: ["type"],
      where: { canvasId, deletedAt: null, type: { not: "POLL" } },
      _count: { _all: true },
    }),
    prisma.$queryRaw<Array<{ tag: string; count: bigint }>>(Prisma.sql`
      SELECT tag, COUNT(*) AS count FROM "CanvasItem", unnest("tags") tag
      WHERE "canvasId" = ${canvasId}
        AND "deletedAt" IS NULL
        AND "type" <> 'POLL'::"ItemType"
      GROUP BY tag ORDER BY count DESC, tag ASC LIMIT 100
    `),
    prisma.$queryRaw<Array<{ revision: bigint }>>`
      SELECT COALESCE(MAX("sequence"), 0) AS revision
      FROM "CanvasEvent" WHERE "canvasId" = ${canvasId}
    `,
  ]);
  const bounds = summary[0];
  return NextResponse.json({
    count: Number(bounds?.count ?? 0n),
    bounds: bounds
      ? {
          minX: bounds.minX,
          minY: bounds.minY,
          maxX: bounds.maxX,
          maxY: bounds.maxY,
        }
      : null,
    types: Object.fromEntries(
      types.map((entry) => [entry.type, entry._count._all]),
    ),
    tags: tags.map((entry) => ({
      value: entry.tag,
      count: Number(entry.count),
    })),
    revision: (revisionRows[0]?.revision ?? 0n).toString(),
  });
});
