import { NextResponse } from "next/server";
import { CanvasViewType } from "@/generated/prisma/client";
import type { Prisma } from "@/generated/prisma/client";
import { z } from "zod";
import { requireAuth, requireCanvasAccess } from "@/lib/api/auth";
import { withApiHandler } from "@/lib/api/route-handler";
import { prisma } from "@/lib/db";

const upsertCanvasViewSchema = z.object({
  viewType: z.nativeEnum(CanvasViewType),
  name: z.string().min(1).max(120).nullable().optional(),
  filters: z.record(z.string(), z.unknown()).nullable().optional(),
  layout: z.record(z.string(), z.unknown()).nullable().optional(),
});

interface RouteContext {
  params: Promise<{ canvasId: string }>;
}

function toJsonValue(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

export const GET = withApiHandler(
  async (request: Request, { params }: RouteContext) => {
    const { userId, email } = await requireAuth();
    const { canvasId } = await params;
    const url = new URL(request.url);
    const viewType = z
      .nativeEnum(CanvasViewType)
      .parse(url.searchParams.get("viewType") || "ORGANIZER");

    await requireCanvasAccess(canvasId, userId, email, "VIEW");

    const view = await prisma.canvasView.findUnique({
      where: {
        userId_canvasId_viewType: {
          userId,
          canvasId,
          viewType,
        },
      },
    });

    return NextResponse.json({ view });
  },
);

export const PUT = withApiHandler(
  async (request: Request, { params }: RouteContext) => {
    const { userId, email } = await requireAuth();
    const { canvasId } = await params;

    await requireCanvasAccess(canvasId, userId, email, "VIEW");

    const body = await request.json();
    const data = upsertCanvasViewSchema.parse(body);

    const view = await prisma.canvasView.upsert({
      where: {
        userId_canvasId_viewType: {
          userId,
          canvasId,
          viewType: data.viewType,
        },
      },
      create: {
        userId,
        canvasId,
        viewType: data.viewType,
        name: data.name ?? null,
        filters: data.filters != null ? toJsonValue(data.filters) : undefined,
        layout: data.layout != null ? toJsonValue(data.layout) : undefined,
      },
      update: {
        name: data.name ?? null,
        filters: data.filters != null ? toJsonValue(data.filters) : undefined,
        layout: data.layout != null ? toJsonValue(data.layout) : undefined,
      },
    });

    return NextResponse.json({ view });
  },
);
