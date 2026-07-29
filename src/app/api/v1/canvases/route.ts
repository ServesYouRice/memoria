import { type NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/api/auth";
import { prisma } from "@/lib/db";
import { z } from "zod";
import { runIdempotent, withApiHandler } from "@/lib/api/route-handler";
import { parsePagination } from "@/lib/api/pagination";
import { ValidationError } from "@/lib/errors";
import { ActivityType, logActivity } from "@/lib/activity";
import { assertCanvasCapacity } from "@/lib/policy/capacity";
import { validatedJson } from "@/lib/api/response";
import { canvasListResponseSchema } from "@/lib/api/response-schemas";

/**
 * GET /api/v1/canvases
 *
 * Fetch canvases for the authenticated user
 * Per ADR-0001: API Versioning & Error Contract (RFC 7807)
 */
export const GET = withApiHandler(async (request: NextRequest) => {
  const { userId } = await requireAuth();

  // Pagination parameters
  const { searchParams } = new URL(request.url);
  const { limit, offset } = parsePagination(searchParams);

  const workspaceId = searchParams.get("workspaceId") || undefined;
  if (workspaceId) {
    const workspace = await prisma.workspace.findFirst({
      where: { id: workspaceId, userId },
      select: { id: true },
    });
    if (!workspace) throw new ValidationError("Workspace not found.");
  }
  const where = {
    userId,
    isTemplate: false,
    ...(workspaceId ? { workspaceId } : {}),
  };

  // Get total count
  const total = await prisma.canvas.count({ where });

  // Fetch canvases with pagination
  const canvases = await prisma.canvas.findMany({
    where,
    orderBy: {
      updatedAt: "desc",
    },
    take: limit,
    skip: offset,
    select: {
      id: true,
      name: true,
      userId: true,
      workspaceId: true,
      zoomLevel: true,
      panX: true,
      panY: true,
      thumbnailKey: true,
      thumbnailRevision: true,
      isPublic: true,
      createdAt: true,
      updatedAt: true,
    },
  });

  return validatedJson(canvasListResponseSchema, {
    canvases: canvases.map((canvas) => ({
      ...canvas,
      thumbnailRevision: canvas.thumbnailRevision.toString(),
    })),
    pagination: {
      total,
      limit,
      offset,
      hasMore: offset + limit < total,
    },
  });
});

const createCanvasSchema = z.object({
  name: z.string().min(1).max(255).optional().default("Untitled Canvas"),
  workspaceId: z.string().cuid().optional(),
});

/**
 * POST /api/v1/canvases
 *
 * Create a new canvas for the authenticated user
 * Per ADR-0001: API Versioning & Error Contract (RFC 7807)
 */
export const POST = withApiHandler(async (request: NextRequest) => {
  const { userId } = await requireAuth();

  return runIdempotent(request, userId, async () => {
    // Parse and validate request body
    // ZodError will be caught automatically by withApiHandler
    const body = await request.json();
    const validatedData = createCanvasSchema.parse(body);

    if (validatedData.workspaceId) {
      const workspace = await prisma.workspace.findFirst({
        where: { id: validatedData.workspaceId, userId },
        select: { id: true },
      });
      if (!workspace) {
        throw new ValidationError("The selected workspace does not exist.");
      }
    }

    // Create canvas
    const canvas = await prisma.$transaction(async (tx) => {
      await assertCanvasCapacity(tx, userId);
      return tx.canvas.create({
        data: {
          name: validatedData.name,
          userId,
          workspaceId: validatedData.workspaceId,
        },
      });
    });

    await logActivity({
      userId,
      type: ActivityType.CANVAS_CREATED,
      canvasId: canvas.id,
      canvasName: canvas.name,
    });

    return NextResponse.json(canvas, { status: 201 });
  });
});
