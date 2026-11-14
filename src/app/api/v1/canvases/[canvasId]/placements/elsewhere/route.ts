import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { withAuth } from "@/lib/api/route-handler";
import { requireCanvasAccess } from "@/lib/api/auth";
import { badRequestError } from "@/lib/errors";
import { placementsElsewhere } from "@/lib/placements/placements";

interface RouteContext {
  params: Promise<{ canvasId: string }>;
}

const itemIdsSchema = z.array(z.string().min(1).max(64)).max(500);

/**
 * GET /api/v1/canvases/{canvasId}/placements/elsewhere?itemIds=a,b (IMP-109):
 * before deleting items, where else each will disappear. The owner gets the
 * canvas names; an editor only how many.
 */
export const GET = withAuth<unknown, RouteContext>(
  async (request, session, { params }) => {
    const { canvasId } = await params;
    const access = await requireCanvasAccess(
      canvasId,
      session.user.id,
      session.user.email ?? "",
      "EDIT",
    );
    const raw = new URL(request.url).searchParams.get("itemIds") ?? "";
    const parsed = itemIdsSchema.safeParse(raw ? raw.split(",") : []);
    if (!parsed.success) throw badRequestError("Invalid item ids.");
    const items = await placementsElsewhere(prisma, {
      canvasId,
      itemIds: parsed.data,
      isOwner: access === "OWNER",
    });
    return NextResponse.json(
      { items },
      { headers: { "Cache-Control": "no-store" } },
    );
  },
);
