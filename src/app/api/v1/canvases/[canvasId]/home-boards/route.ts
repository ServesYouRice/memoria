import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/api/auth";
import { withApiHandler } from "@/lib/api/route-handler";
import { listHomeBoardSuggestions } from "@/lib/agents/home-board";

interface RouteContext {
  params: Promise<{ canvasId: string }>;
}

/**
 * Suggested home boards for items on this board (the Inbox, IMP-066), plus
 * what was filed from it this week so a move can be undone. Owner only.
 */
export const GET = withApiHandler(
  async (_request: Request, { params }: RouteContext) => {
    const { userId } = await requireAuth();
    const { canvasId } = await params;
    return NextResponse.json(
      await listHomeBoardSuggestions({ userId, canvasId }),
    );
  },
);
