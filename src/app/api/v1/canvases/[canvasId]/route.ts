import { NextResponse } from "next/server";
import {
  requireAuth,
  requireCanvasOwnership,
  requireCanvasAccess,
} from "@/lib/api/auth";
import { prisma } from "@/lib/db";
import { z } from "zod";
import { NotFoundError } from "@/lib/errors";
import { invalidateCanvasCache } from "@/lib/cache/canvas-cache";
import { withApiHandler } from "@/lib/api/route-handler";
import { ActivityType, logActivity } from "@/lib/activity";
import { enqueueUploadDeletion } from "@/lib/uploads/lifecycle";

const updateCanvasSchema = z
  .object({
    name: z.string().min(1).max(255).optional(),
    defaultViewport: z
      .object({
        zoomLevel: z.number().min(0.1).max(5),
        panX: z.number().finite(),
        panY: z.number().finite(),
      })
      .strict()
      .optional(),
    workspaceId: z.string().cuid().nullable().optional(),
  })
  .strict();

interface RouteContext {
  params: Promise<{ canvasId: string }>;
}

export const GET = withApiHandler(
  async (_request: Request, { params }: RouteContext) => {
    const { userId, email } = await requireAuth();
    const { canvasId } = await params;

    // Verify canvas access (ownership or share)
    await requireCanvasAccess(canvasId, userId, email, "VIEW");

    // Item pages are loaded by the dedicated, paginated item endpoint. Do not
    // duplicate the full canvas payload in this metadata request.
    const canvasData = await prisma.canvas.findUnique({
      where: { id: canvasId },
    });
    if (!canvasData) {
      throw new NotFoundError("Canvas not found");
    }

    // 4. Fetch user-specific share info (always fresh)
    const shares = await prisma.canvasShare.findMany({
      where: {
        canvasId,
        recipientId: userId,
      },
      select: {
        id: true,
        role: true,
        createdAt: true,
      },
    });

    // 5. Return combined response
    return NextResponse.json({
      ...canvasData,
      shares,
      accessLevel:
        canvasData.userId === userId ? "OWNER" : shares[0]?.role || "VIEW",
    });
  },
);

export const PATCH = withApiHandler(
  async (request: Request, { params }: RouteContext) => {
    const { userId } = await requireAuth();
    const { canvasId } = await params;

    // Verify canvas ownership
    await requireCanvasOwnership(canvasId, userId);

    // Parse and validate request body
    const body = await request.json();
    const validatedData = updateCanvasSchema.parse(body);
    const { defaultViewport, ...canvasFields } = validatedData;

    if (validatedData.workspaceId) {
      const workspace = await prisma.workspace.findFirst({
        where: {
          id: validatedData.workspaceId,
          userId,
        },
        select: { id: true },
      });

      if (!workspace) {
        throw new NotFoundError("Workspace not found");
      }
    }

    // Update canvas
    const updatedCanvas = await prisma.canvas.update({
      where: { id: canvasId },
      data: {
        ...canvasFields,
        ...(defaultViewport || {}),
      },
    });

    // Invalidate cache
    await invalidateCanvasCache(canvasId);

    await logActivity({
      userId,
      type: ActivityType.CANVAS_UPDATED,
      canvasId,
      canvasName: updatedCanvas.name,
    });

    return NextResponse.json(updatedCanvas);
  },
);

export const DELETE = withApiHandler(
  async (_request: Request, { params }: RouteContext) => {
    const { userId } = await requireAuth();
    const { canvasId } = await params;

    // Verify canvas ownership
    await requireCanvasOwnership(canvasId, userId);

    // Delete canvas (cascade will delete items, shares, etc.)
    const deletedCanvas = await prisma.$transaction(async (tx) => {
      const assets = await tx.uploadAsset.findMany({
        where: { canvasId, status: { not: "DELETED" } },
        select: { id: true },
      });
      for (const asset of assets) await enqueueUploadDeletion(tx, asset.id);
      return tx.canvas.delete({ where: { id: canvasId } });
    });

    // Invalidate cache
    await invalidateCanvasCache(canvasId);

    await logActivity({
      userId,
      type: ActivityType.CANVAS_DELETED,
      canvasId,
      canvasName: deletedCanvas.name,
    });

    return NextResponse.json(
      { message: "Canvas deleted successfully" },
      { status: 200 },
    );
  },
);
