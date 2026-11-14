import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { withAuth } from "@/lib/api/route-handler";
import { getCanvasAccess, requireCanvasAccess } from "@/lib/api/auth";
import { listCanvasPlacements } from "@/lib/placements/placements";

interface RouteContext {
  params: Promise<{ canvasId: string }>;
}

/**
 * GET /api/v1/canvases/{canvasId}/placements (IMP-109): items from other
 * canvases shown on this one, with where they sit here. Anyone who may view
 * this canvas sees them; their home canvas is named only to those who may
 * open it.
 */
export const GET = withAuth<unknown, RouteContext>(
  async (_request, session, { params }) => {
    const { canvasId } = await params;
    const email = session.user.email ?? "";
    await requireCanvasAccess(canvasId, session.user.id, email, "VIEW");
    const placements = await listCanvasPlacements(
      prisma,
      canvasId,
      async (homeCanvasId) =>
        (await getCanvasAccess(homeCanvasId, session.user.id, email)) !==
        "NONE",
    );
    return NextResponse.json(
      { placements },
      { headers: { "Cache-Control": "no-store" } },
    );
  },
);
