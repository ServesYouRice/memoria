import { type NextRequest } from "next/server";
import { ItemType, Prisma, type CanvasItem } from "@/generated/prisma/client";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { errorResponse, NotFoundError, ForbiddenError } from "@/lib/errors";
import { boundedItemsResponse } from "@/lib/api/bounded-response";

const querySchema = z
  .object({
    minX: z.coerce.number().finite().optional(),
    maxX: z.coerce.number().finite().optional(),
    minY: z.coerce.number().finite().optional(),
    maxY: z.coerce.number().finite().optional(),
    limit: z.coerce.number().int().min(1).max(100).default(50),
    offset: z.coerce.number().int().min(0).max(10_000).default(0),
  })
  .refine(
    (value) =>
      [value.minX, value.maxX, value.minY, value.maxY].every(
        (coordinate) => coordinate === undefined,
      ) ||
      [value.minX, value.maxX, value.minY, value.maxY].every(
        (coordinate) => coordinate !== undefined,
      ),
    "Provide all viewport bounds or none",
  );

interface RouteContext {
  params: Promise<{ token: string }>;
}

export async function GET(request: NextRequest, { params }: RouteContext) {
  try {
    const { token } = await params;
    const query = querySchema.parse(
      Object.fromEntries(request.nextUrl.searchParams),
    );
    const canvas = await prisma.canvas.findUnique({
      where: { shareToken: token },
      select: {
        id: true,
        name: true,
        isPublic: true,
        zoomLevel: true,
        panX: true,
        panY: true,
        user: { select: { name: true } },
      },
    });
    if (!canvas) throw new NotFoundError("Canvas not found");
    if (!canvas.isPublic)
      throw new ForbiddenError("This canvas is not publicly shared");

    const hasViewport = query.minX !== undefined;
    const spatial = hasViewport
      ? Prisma.sql`
          AND ("positionX" + "width") >= ${query.minX!}
          AND "positionX" <= ${query.maxX!}
          AND ("positionY" + "height") >= ${query.minY!}
          AND "positionY" <= ${query.maxY!}
        `
      : Prisma.empty;
    const countRows = await prisma.$queryRaw<Array<{ count: bigint }>>`
      SELECT COUNT(*) AS count FROM "CanvasItem"
      WHERE "canvasId" = ${canvas.id} AND "deletedAt" IS NULL
        AND "type" <> ${ItemType.POLL}::"ItemType" ${spatial}
    `;
    const items = await prisma.$queryRaw<CanvasItem[]>`
      SELECT "id", "canvasId", "type", "positionX", "positionY", "width",
        "height", "zIndex", "content", "tags", "version", "createdById",
        "updatedById", "deletedById", "createdAt", "updatedAt", "deletedAt",
        "bookmarkRefreshedAt"
      FROM "CanvasItem"
      WHERE "canvasId" = ${canvas.id} AND "deletedAt" IS NULL
        AND "type" <> ${ItemType.POLL}::"ItemType" ${spatial}
      ORDER BY "zIndex" ASC, "id" ASC
      LIMIT ${query.limit} OFFSET ${query.offset}
    `;
    const total = Number(countRows[0]?.count ?? 0n);
    return boundedItemsResponse(items, {
      canvas: {
        id: canvas.id,
        name: canvas.name,
        owner: canvas.user.name || "Anonymous",
        zoomLevel: canvas.zoomLevel,
        panX: canvas.panX,
        panY: canvas.panY,
      },
      total,
      offset: query.offset,
      limit: query.limit,
      hasMore: query.offset + items.length < total,
    });
  } catch (error) {
    return errorResponse(error, request.url);
  }
}
