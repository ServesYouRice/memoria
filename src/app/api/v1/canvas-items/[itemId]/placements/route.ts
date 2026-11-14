import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { withAuth, withAuthValidation } from "@/lib/api/route-handler";
import {
  createPlacement,
  createPlacementSchema,
  listItemPlacements,
  publishPlacementChanged,
} from "@/lib/placements/placements";

interface RouteContext {
  params: Promise<{ itemId: string }>;
}

const NO_STORE = { "Cache-Control": "no-store" };

/**
 * GET /api/v1/canvas-items/{itemId}/placements (IMP-109): the other
 * canvases this item shows on. Only the owner of its home canvas may ask.
 */
export const GET = withAuth<unknown, RouteContext>(
  async (_request, session, { params }) => {
    const { itemId } = await params;
    const result = await listItemPlacements(prisma, {
      itemId,
      userId: session.user.id,
    });
    return NextResponse.json(result, { headers: NO_STORE });
  },
);

/**
 * POST /api/v1/canvas-items/{itemId}/placements `{ canvasId }`: also show the
 * item on another of the owner's canvases.
 */
export const POST = withAuthValidation(
  createPlacementSchema,
  async (data, _request, session, context) => {
    const { itemId } = await (context as RouteContext).params;
    const placement = await createPlacement(prisma, {
      itemId,
      canvasId: data.canvasId,
      userId: session.user.id,
    });
    await publishPlacementChanged([placement.canvasId], itemId);
    return NextResponse.json(placement, { status: 201, headers: NO_STORE });
  },
);
