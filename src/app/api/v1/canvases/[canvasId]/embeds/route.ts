/**
 * Canvas Embeds API (owner only)
 * GET  /api/v1/canvases/[canvasId]/embeds - List embeds (never returns tokens)
 * POST /api/v1/canvases/[canvasId]/embeds - Create an embed; the signed token
 *      is returned once and only its digest is stored
 */

import { type NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireAuth } from "@/lib/api/auth";
import { withApiHandler } from "@/lib/api/route-handler";
import { BadRequestError, fromZodError } from "@/lib/errors";
import { createEmbedSchema } from "@/lib/embeds/schemas";
import { createCanvasEmbed, listCanvasEmbeds } from "@/lib/embeds/service";

interface RouteContext {
  params: Promise<{ canvasId: string }>;
}

export const GET = withApiHandler(
  async (_request: NextRequest, { params }: RouteContext) => {
    const { userId } = await requireAuth();
    const { canvasId } = await params;
    const embeds = await listCanvasEmbeds(prisma, canvasId, userId);
    return NextResponse.json({ embeds });
  },
);

export const POST = withApiHandler(
  async (request: NextRequest, { params }: RouteContext) => {
    const { userId } = await requireAuth();
    const { canvasId } = await params;

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      throw new BadRequestError("Request body must be valid JSON");
    }
    const parsed = createEmbedSchema.safeParse(body);
    if (!parsed.success) throw fromZodError(parsed.error);

    const { embed, token } = await createCanvasEmbed(
      prisma,
      canvasId,
      userId,
      parsed.data,
    );

    const baseUrl =
      process.env.AUTH_URL ||
      process.env.NEXTAUTH_URL ||
      request.nextUrl.origin;
    const response = NextResponse.json(
      { embed, token, embedUrl: `${baseUrl}/embed/${token}` },
      { status: 201 },
    );
    response.headers.set("Cache-Control", "no-store");
    return response;
  },
);
