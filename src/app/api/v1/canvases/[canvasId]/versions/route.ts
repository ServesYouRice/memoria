/**
 * Canvas Versions API
 * Manage canvas version history
 */

import { type NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/api/auth";
import { prisma } from "@/lib/db";
import { z } from "zod";
import {
  NotFoundError,
  ForbiddenError,
  errorResponse,
  fromZodError,
} from "@/lib/errors";
import { parsePagination } from "@/lib/api/pagination";
import { assertCanvasVersionCapacity } from "@/lib/policy/capacity";

interface RouteContext {
  params: Promise<{ canvasId: string }>;
}

const createVersionSchema = z.object({
  name: z.string().min(1).max(100).optional(),
});

/**
 * POST /api/v1/canvases/[canvasId]/versions
 * Create a new version snapshot
 */
export async function POST(request: NextRequest, { params }: RouteContext) {
  try {
    const { userId } = await requireAuth();
    const { canvasId } = await params;

    const body = await request.json();
    const validation = createVersionSchema.safeParse(body);
    if (!validation.success) {
      throw fromZodError(validation.error);
    }

    const { name } = validation.data;

    // Verify canvas ownership
    const canvas = await prisma.canvas.findUnique({
      where: { id: canvasId },
      include: {
        items: {
          where: { deletedAt: null },
        },
      },
    });

    if (!canvas) {
      throw new NotFoundError("Canvas not found");
    }

    if (canvas.userId !== userId) {
      throw new ForbiddenError(
        "You can only create versions of your own canvases",
      );
    }

    // Create snapshot
    const snapshot = {
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

    const versionName = name || `Version ${new Date().toLocaleString()}`;

    const version = await prisma.$transaction(async (tx) => {
      await assertCanvasVersionCapacity(tx, canvasId);
      return tx.canvasVersion.create({
        data: { canvasId, name: versionName, snapshot },
      });
    });

    return NextResponse.json(version, { status: 201 });
  } catch (error) {
    return errorResponse(error, request.url);
  }
}

/**
 * GET /api/v1/canvases/[canvasId]/versions
 * List all versions for a canvas
 */
export async function GET(request: NextRequest, { params }: RouteContext) {
  try {
    const { userId } = await requireAuth();
    const { canvasId } = await params;
    const { searchParams } = new URL(request.url);
    const { limit, offset } = parsePagination(searchParams, {
      defaultLimit: 50,
      maxLimit: 100,
    });

    // Verify canvas ownership
    const canvas = await prisma.canvas.findUnique({
      where: { id: canvasId },
    });

    if (!canvas) {
      throw new NotFoundError("Canvas not found");
    }

    if (canvas.userId !== userId) {
      throw new ForbiddenError(
        "You can only view versions of your own canvases",
      );
    }

    const [versions, total] = await Promise.all([
      prisma.canvasVersion.findMany({
        where: { canvasId },
        orderBy: { createdAt: "desc" },
        take: limit,
        skip: offset,
        select: {
          id: true,
          name: true,
          createdAt: true,
        },
      }),
      prisma.canvasVersion.count({ where: { canvasId } }),
    ]);

    return NextResponse.json({
      versions,
      pagination: {
        total,
        limit,
        offset,
        hasMore: offset + limit < total,
      },
    });
  } catch (error) {
    return errorResponse(error, request.url);
  }
}
