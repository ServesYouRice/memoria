import { type NextRequest, NextResponse } from "next/server";
import { requireAuth, requireCanvasAccess } from "@/lib/api/auth";
import { prisma } from "@/lib/db";
import { z } from "zod";
import { withApiHandler } from "@/lib/api/route-handler";
import { parsePagination } from "@/lib/api/pagination";
import { lockCanvasForMutation } from "@/lib/canvas/mutation-lock";
import { assertCanvasItemCapacity } from "@/lib/policy/capacity";
import { invalidateCanvasCache } from "@/lib/cache/canvas-cache";
import {
  LINK_LABEL_MAX,
  LINK_STYLES,
  LinkEndpointError,
  createLinkArrow,
} from "@/lib/canvas/arrow-links";

interface RouteParams {
  params: Promise<{ canvasId: string }>;
}

/**
 * GET /api/v1/canvases/:canvasId/connections
 *
 * Get all connections for a canvas
 */
export const GET = withApiHandler(
  async (request: NextRequest, { params }: RouteParams) => {
    const { userId, email } = await requireAuth();
    const { canvasId } = await params;

    await requireCanvasAccess(canvasId, userId, email, "VIEW");

    const { limit, offset } = parsePagination(request.nextUrl.searchParams);
    const [connections, total] = await Promise.all([
      prisma.itemConnection.findMany({
        where: { canvasId },
        orderBy: { createdAt: "asc" },
        take: limit,
        skip: offset,
      }),
      prisma.itemConnection.count({ where: { canvasId } }),
    ]);

    return NextResponse.json({
      connections: connections.map((c) => ({
        id: c.id,
        fromId: c.fromId,
        toId: c.toId,
        label: c.label,
        style: c.style,
        createdAt: c.createdAt.toISOString(),
      })),
      pagination: {
        total,
        limit,
        offset,
        hasMore: offset + connections.length < total,
      },
    });
  },
);

const createConnectionSchema = z.object({
  fromId: z.string().cuid(),
  toId: z.string().cuid(),
  label: z.string().trim().max(LINK_LABEL_MAX).optional(),
  style: z.enum(LINK_STYLES).default("SOLID"),
});

/**
 * POST /api/v1/canvases/:canvasId/connections
 *
 * Link two items on the canvas. Arrows are the one record of a link
 * (IMP-095), so this draws an arrow between them; the link row follows it.
 */
export const POST = withApiHandler(
  async (request: NextRequest, { params }: RouteParams) => {
    const { userId, email } = await requireAuth();
    const { canvasId } = await params;

    await requireCanvasAccess(canvasId, userId, email, "EDIT");

    const body = await request.json();
    const data = createConnectionSchema.parse(body);

    let connection;
    try {
      connection = await prisma.$transaction(async (tx) => {
        await lockCanvasForMutation(tx, canvasId);
        await assertCanvasItemCapacity(tx, canvasId);
        const { link } = await createLinkArrow(tx, {
          canvasId,
          actorId: userId,
          fromId: data.fromId,
          toId: data.toId,
          label: data.label,
          style: data.style,
        });
        if (!link) throw new LinkEndpointError();
        return link;
      });
    } catch (error) {
      if (error instanceof LinkEndpointError) {
        return NextResponse.json(
          { error: "One or both items not found in this canvas" },
          { status: 400 },
        );
      }
      throw error;
    }
    await invalidateCanvasCache(canvasId);

    return NextResponse.json(
      {
        id: connection.id,
        fromId: connection.fromId,
        toId: connection.toId,
        label: connection.label,
        style: connection.style,
        createdAt: connection.createdAt.toISOString(),
      },
      { status: 201 },
    );
  },
);
