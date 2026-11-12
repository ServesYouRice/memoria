import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAuth, requireCanvasAccess } from "@/lib/api/auth";
import { withApiHandler } from "@/lib/api/route-handler";
import { prisma } from "@/lib/db";
import { requireTemplatesEnabled } from "@/lib/templates/availability";
import { duplicateCanvas } from "@/lib/canvas/duplicate-canvas";

interface RouteContext {
  params: Promise<{ canvasId: string }>;
}

const paramsSchema = z.object({ canvasId: z.string().min(1).max(64) });
const bodySchema = z
  .object({ name: z.string().trim().max(255).optional() })
  .strict();

/**
 * IMP-098 — a private copy of a canvas the caller owns: every item, frame,
 * picture and attached arrow; no shares, comments or versions.
 */
export const POST = withApiHandler(
  async (request: Request, { params }: RouteContext) => {
    const { userId, email } = await requireAuth();
    requireTemplatesEnabled("canvasDuplication");
    const { canvasId } = paramsSchema.parse(await params);
    const text = await request.text();
    const body = bodySchema.parse(text ? JSON.parse(text) : {});
    await requireCanvasAccess(canvasId, userId, email, "OWNER");
    const copy = await duplicateCanvas(prisma, {
      userId,
      canvasId,
      name: body.name,
    });
    return NextResponse.json(copy, { status: 201 });
  },
);
