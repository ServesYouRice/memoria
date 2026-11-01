/**
 * DELETE /api/v1/canvases/[canvasId]/embeds/[embedId] - Revoke an embed (owner only)
 */

import { type NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireAuth } from "@/lib/api/auth";
import { withApiHandler } from "@/lib/api/route-handler";
import { revokeCanvasEmbed } from "@/lib/embeds/service";

interface RouteContext {
  params: Promise<{ canvasId: string; embedId: string }>;
}

export const DELETE = withApiHandler(
  async (_request: NextRequest, { params }: RouteContext) => {
    const { userId } = await requireAuth();
    const { canvasId, embedId } = await params;
    await revokeCanvasEmbed(prisma, canvasId, embedId, userId);
    return NextResponse.json({ success: true });
  },
);
