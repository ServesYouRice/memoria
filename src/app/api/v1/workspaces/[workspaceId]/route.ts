import { type NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/api/auth";
import { prisma } from "@/lib/db";
import { z } from "zod";
import { withApiHandler } from "@/lib/api/route-handler";
import { NotFoundError, ForbiddenError } from "@/lib/errors";

interface RouteParams {
  params: Promise<{ workspaceId: string }>;
}

/**
 * GET /api/v1/workspaces/:workspaceId
 *
 * Get a specific workspace with its canvases
 */
export const GET = withApiHandler(
  async (_request: NextRequest, { params }: RouteParams) => {
    const { userId } = await requireAuth();
    const { workspaceId } = await params;

    const workspace = await prisma.workspace.findUnique({
      where: { id: workspaceId },
      include: {
        canvases: {
          orderBy: { updatedAt: "desc" },
          select: {
            id: true,
            name: true,
            thumbnail: true,
            updatedAt: true,
          },
        },
      },
    });

    if (!workspace) {
      throw new NotFoundError("Workspace not found");
    }

    if (workspace.userId !== userId) {
      throw new ForbiddenError("You do not have access to this workspace");
    }

    return NextResponse.json({
      id: workspace.id,
      name: workspace.name,
      canvases: workspace.canvases.map((c) => ({
        id: c.id,
        name: c.name,
        thumbnail: c.thumbnail,
        updatedAt: c.updatedAt.toISOString(),
      })),
      createdAt: workspace.createdAt.toISOString(),
      updatedAt: workspace.updatedAt.toISOString(),
    });
  },
);

const updateWorkspaceSchema = z.object({
  name: z.string().min(1).max(100).optional(),
});

/**
 * PATCH /api/v1/workspaces/:workspaceId
 *
 * Update a workspace
 */
export const PATCH = withApiHandler(
  async (request: NextRequest, { params }: RouteParams) => {
    const { userId } = await requireAuth();
    const { workspaceId } = await params;

    const workspace = await prisma.workspace.findUnique({
      where: { id: workspaceId },
    });

    if (!workspace) {
      throw new NotFoundError("Workspace not found");
    }

    if (workspace.userId !== userId) {
      throw new ForbiddenError("You do not have access to this workspace");
    }

    const body = await request.json();
    const updates = updateWorkspaceSchema.parse(body);

    const updated = await prisma.workspace.update({
      where: { id: workspaceId },
      data: updates,
    });

    return NextResponse.json({
      id: updated.id,
      name: updated.name,
      createdAt: updated.createdAt.toISOString(),
      updatedAt: updated.updatedAt.toISOString(),
    });
  },
);

/**
 * DELETE /api/v1/workspaces/:workspaceId
 *
 * Delete a workspace (canvases are unassigned, not deleted)
 */
export const DELETE = withApiHandler(
  async (_request: NextRequest, { params }: RouteParams) => {
    const { userId } = await requireAuth();
    const { workspaceId } = await params;

    const workspace = await prisma.workspace.findUnique({
      where: { id: workspaceId },
    });

    if (!workspace) {
      throw new NotFoundError("Workspace not found");
    }

    if (workspace.userId !== userId) {
      throw new ForbiddenError("You do not have access to this workspace");
    }

    // Unassign canvases from this workspace before deleting
    await prisma.$transaction(async (tx) => {
      await tx.canvas.updateMany({
        where: { workspaceId, userId },
        data: { workspaceId: null },
      });
      await tx.workspace.delete({
        where: { id: workspaceId },
      });
    });

    return NextResponse.json({ success: true });
  },
);
