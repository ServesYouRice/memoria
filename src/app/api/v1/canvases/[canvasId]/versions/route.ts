import { type NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAuth } from "@/lib/api/auth";
import { prisma } from "@/lib/db";
import {
  NotFoundError,
  ForbiddenError,
  ValidationError,
  errorResponse,
} from "@/lib/errors";
import { parsePagination } from "@/lib/api/pagination";
import { assertCanvasVersionCapacity } from "@/lib/policy/capacity";
import { LAUNCH_LIMITS } from "@/lib/policy/launch-limits";
import { lockCanvasForMutation } from "@/lib/canvas/mutation-lock";

interface RouteContext {
  params: Promise<{ canvasId: string }>;
}
const createVersionSchema = z
  .object({ name: z.string().min(1).max(100).optional() })
  .strict();

export async function POST(request: NextRequest, { params }: RouteContext) {
  try {
    const { userId } = await requireAuth();
    const { canvasId } = await params;
    const { name } = createVersionSchema.parse(await request.json());
    const version = await prisma.$transaction(
      async (tx) => {
        await lockCanvasForMutation(tx, canvasId);
        const canvas = await tx.canvas.findUnique({
          where: { id: canvasId },
          include: { items: { where: { deletedAt: null } } },
        });
        if (!canvas) throw new NotFoundError("Canvas not found");
        if (canvas.userId !== userId)
          throw new ForbiddenError(
            "You can only create versions of your own canvases",
          );
        if (canvas.items.length > LAUNCH_LIMITS.itemsPerCanvas) {
          throw new ValidationError(
            "Canvas exceeds the supported snapshot item limit",
          );
        }
        const snapshot = {
          schemaVersion: 1,
          name: canvas.name,
          zoomLevel: canvas.zoomLevel,
          panX: canvas.panX,
          panY: canvas.panY,
          items: canvas.items.map((item) => ({
            id: item.id,
            type: item.type,
            positionX: item.positionX,
            positionY: item.positionY,
            width: item.width,
            height: item.height,
            zIndex: item.zIndex,
            content: item.content,
            tags: item.tags,
            version: item.version,
            createdById: item.createdById,
            updatedById: item.updatedById,
          })),
        };
        if (
          Buffer.byteLength(JSON.stringify(snapshot), "utf8") >
          LAUNCH_LIMITS.versionSnapshotBytes
        ) {
          throw new ValidationError(
            "Canvas snapshot exceeds the supported byte limit",
          );
        }
        await assertCanvasVersionCapacity(tx, canvasId);
        return tx.canvasVersion.create({
          data: {
            canvasId,
            name: name || `Version ${new Date().toISOString()}`,
            snapshot,
          },
        });
      },
      { maxWait: 5_000, timeout: 15_000 },
    );
    return NextResponse.json(version, { status: 201 });
  } catch (error) {
    return errorResponse(error, request.url);
  }
}

export async function GET(request: NextRequest, { params }: RouteContext) {
  try {
    const { userId } = await requireAuth();
    const { canvasId } = await params;
    const { limit, offset } = parsePagination(
      new URL(request.url).searchParams,
      { defaultLimit: 50, maxLimit: 100 },
    );
    const canvas = await prisma.canvas.findUnique({
      where: { id: canvasId },
      select: { userId: true },
    });
    if (!canvas) throw new NotFoundError("Canvas not found");
    if (canvas.userId !== userId)
      throw new ForbiddenError(
        "You can only view versions of your own canvases",
      );
    const [versions, total] = await Promise.all([
      prisma.canvasVersion.findMany({
        where: { canvasId },
        orderBy: { createdAt: "desc" },
        take: limit,
        skip: offset,
        select: { id: true, name: true, createdAt: true },
      }),
      prisma.canvasVersion.count({ where: { canvasId } }),
    ]);
    return NextResponse.json({
      versions,
      pagination: {
        total,
        limit,
        offset,
        hasMore: offset + versions.length < total,
      },
    });
  } catch (error) {
    return errorResponse(error, request.url);
  }
}
