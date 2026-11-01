import { type NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAuth, requireCanvasAccess } from "@/lib/api/auth";
import { prisma } from "@/lib/db";
import { NotFoundError, errorResponse } from "@/lib/errors";
import { versionSummarySelect } from "@/lib/versions/summary";

interface RouteContext {
  params: Promise<{ canvasId: string; versionId: string }>;
}

const paramsSchema = z.object({
  canvasId: z.string().min(1).max(128),
  versionId: z.string().min(1).max(128),
});

/**
 * One version with its snapshot, for a read-only preview. Anyone who can view
 * the canvas can read it; restoring needs edit access (restore route).
 */
export async function GET(request: NextRequest, { params }: RouteContext) {
  try {
    const { userId, email } = await requireAuth();
    const { canvasId, versionId } = paramsSchema.parse(await params);
    await requireCanvasAccess(canvasId, userId, email, "VIEW");
    const version = await prisma.canvasVersion.findFirst({
      where: { id: versionId, canvasId },
      select: { ...versionSummarySelect, snapshot: true },
    });
    if (!version) throw new NotFoundError("Version not found");
    return NextResponse.json(version);
  } catch (error) {
    return errorResponse(error, request.url);
  }
}
