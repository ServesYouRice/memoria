/**
 * Individual Canvas Share API
 * DELETE /api/v1/canvases/[canvasId]/share/[shareId] - Revoke share
 */

import { type NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireAuth } from "@/lib/api/auth";
import { errorResponse, ForbiddenError, NotFoundError } from "@/lib/errors";

interface RouteContext {
  params: Promise<{ canvasId: string; shareId: string }>;
}

/**
 * DELETE - Revoke share
 */
export async function DELETE(request: NextRequest, { params }: RouteContext) {
  try {
    const { userId } = await requireAuth();
    const { canvasId, shareId } = await params;

    await prisma.$transaction(async (tx) => {
      const canvas = await tx.canvas.findUnique({
        where: { id: canvasId },
        select: { userId: true },
      });
      if (!canvas || canvas.userId !== userId) {
        throw new ForbiddenError(
          "You do not have permission to revoke shares for this canvas",
        );
      }

      const share = await tx.canvasShare.findFirst({
        where: { id: shareId, canvasId },
        select: { id: true },
      });
      if (share) {
        await tx.canvasShare.delete({ where: { id: share.id } });
        return;
      }

      const invitation = await tx.canvasShareInvitation.findFirst({
        where: { id: shareId, canvasId, respondedAt: null },
        select: { id: true },
      });
      if (!invitation) throw new NotFoundError("Share not found");
      await tx.canvasShareInvitation.update({
        where: { id: invitation.id },
        data: { respondedAt: new Date(), response: "REVOKED" },
      });
    });

    return NextResponse.json({
      success: true,
      message: "Share revoked successfully",
    });
  } catch (error) {
    return errorResponse(error, request.url);
  }
}
