import { NextResponse } from "next/server";
import { Prisma } from "@/generated/prisma/client";
import { z } from "zod";
import { requireAuth, requireCanvasAccess } from "@/lib/api/auth";
import { withApiHandler } from "@/lib/api/route-handler";
import { prisma } from "@/lib/db";

const querySchema = z.object({
  canvasId: z.string().cuid(),
  // Only the committed-event revision: a cheap read a client takes before
  // loading items, to seed its event replay.
  revisionOnly: z.enum(["1", "true"]).optional(),
});

export const GET = withApiHandler(async (request: Request) => {
  const { userId, email } = await requireAuth();
  const { canvasId, revisionOnly } = querySchema.parse(
    Object.fromEntries(new URL(request.url).searchParams),
  );
  await requireCanvasAccess(canvasId, userId, email, "VIEW");
  if (revisionOnly) {
    // One statement, so both numbers come from one snapshot. Event inserts
    // for a canvas are serialized by its counter row, so no event at or
    // below these values can commit after this read.
    const rows = await prisma.$queryRaw<
      Array<{ revision: bigint; canvasRevision: bigint }>
    >`
      SELECT
        COALESCE((SELECT MAX("sequence") FROM "CanvasEvent"
          WHERE "canvasId" = ${canvasId}), 0) AS revision,
        "eventSequence" AS "canvasRevision"
      FROM "Canvas" WHERE "id" = ${canvasId}
    `;
    return NextResponse.json({
      revision: (rows[0]?.revision ?? 0n).toString(),
      canvasRevision: (rows[0]?.canvasRevision ?? 0n).toString(),
    });
  }
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
