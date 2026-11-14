import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { withAuth, withAuthValidation } from "@/lib/api/route-handler";
import { requireCanvasAccess } from "@/lib/api/auth";
import {
  deletePlacement,
  publishPlacementChanged,
  updatePlacement,
  updatePlacementSchema,
} from "@/lib/placements/placements";

interface RouteContext {
  params: Promise<{ canvasId: string; placementId: string }>;
}

/**
 * PATCH /api/v1/canvases/{canvasId}/placements/{placementId} (IMP-109): move
 * or resize a shown item on this canvas. Its content and its home canvas are
 * not touched. Needs edit access to this canvas.
 */
export const PATCH = withAuthValidation(
  updatePlacementSchema,
  async (data, _request, session, context) => {
    const { canvasId, placementId } = await (context as RouteContext).params;
    await requireCanvasAccess(
      canvasId,
      session.user.id,
      session.user.email ?? "",
      "EDIT",
    );
    const placement = await updatePlacement(prisma, {
      canvasId,
      placementId,
      data,
    });
    await publishPlacementChanged([canvasId], placementId);
    return NextResponse.json(placement);
  },
);

/**
 * DELETE …/placements/{placementId}: take the item off this canvas. Its home
 * canvas and the other canvases keep it.
 */
export const DELETE = withAuth<unknown, RouteContext>(
  async (_request, session, { params }) => {
    const { canvasId, placementId } = await params;
    await requireCanvasAccess(
      canvasId,
      session.user.id,
      session.user.email ?? "",
      "EDIT",
    );
    const placement = await deletePlacement(prisma, { canvasId, placementId });
    await publishPlacementChanged([canvasId], placement.itemId);
    return new NextResponse(null, { status: 204 });
  },
);
