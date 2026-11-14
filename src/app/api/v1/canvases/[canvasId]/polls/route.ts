import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { withAuth } from "@/lib/api/route-handler";
import { requireCanvasAccess } from "@/lib/api/auth";
import { requirePollsEnabled } from "@/lib/polls/availability";
import { readCanvasPollResults } from "@/lib/polls/votes";
import { ItemType } from "@/types/canvas";

interface RouteContext {
  params: Promise<{ canvasId: string }>;
}

/**
 * GET /api/v1/canvases/{canvasId}/polls (IMP-104): the counts of every poll
 * on the canvas, and the caller's own choices. Anyone who may view the
 * canvas may read them; no one sees who else voted for what.
 */
export const GET = withAuth<unknown, RouteContext>(
  async (_request, session, { params }) => {
    requirePollsEnabled(ItemType.POLL);
    const { canvasId } = await params;
    await requireCanvasAccess(
      canvasId,
      session.user.id,
      session.user.email ?? "",
      "VIEW",
    );
    const polls = await readCanvasPollResults(
      prisma,
      canvasId,
      session.user.id,
    );
    return NextResponse.json(
      { polls },
      { headers: { "Cache-Control": "no-store" } },
    );
  },
);
