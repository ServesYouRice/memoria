import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAuth } from "@/lib/api/auth";
import { withApiHandler } from "@/lib/api/route-handler";
import { prisma } from "@/lib/db";
import { requireTemplatesEnabled } from "@/lib/templates/availability";
import { createCanvasFromTemplate } from "@/lib/templates/use-template";

interface RouteContext {
  params: Promise<{ templateId: string }>;
}

const paramsSchema = z.object({ templateId: z.string().min(1).max(64) });
const bodySchema = z
  .object({
    name: z.string().trim().max(255).optional(),
    workspaceId: z.string().cuid().optional(),
  })
  .strict();

/** IMP-098 — a new canvas of the caller's own, from a built-in template. */
export const POST = withApiHandler(
  async (request: Request, { params }: RouteContext) => {
    const { userId } = await requireAuth();
    requireTemplatesEnabled();
    const { templateId } = paramsSchema.parse(await params);
    const text = await request.text();
    const body = bodySchema.parse(text ? JSON.parse(text) : {});
    const created = await createCanvasFromTemplate(prisma, {
      userId,
      templateId,
      ...body,
    });
    return NextResponse.json(created, { status: 201 });
  },
);
