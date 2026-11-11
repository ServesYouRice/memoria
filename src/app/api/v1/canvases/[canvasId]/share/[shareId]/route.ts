/**
 * Individual Canvas Share API
 * DELETE /api/v1/canvases/[canvasId]/share/[shareId] - Revoke share
 */

import { type NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireAuth } from "@/lib/api/auth";
import {
  ConflictError,
  errorResponse,
  ForbiddenError,
  NotFoundError,
} from "@/lib/errors";

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

      // Revoke only while the invitation is still pending. The acceptance
      // route holds the row lock while it answers; under READ COMMITTED this
      // update waits for it and then re-checks respondedAt against the
      // committed row, so a won acceptance is never overwritten as REVOKED.
      const revoked = await tx.canvasShareInvitation.updateMany({
        where: { id: shareId, canvasId, respondedAt: null },
        data: { respondedAt: new Date(), response: "REVOKED" },
      });
      if (revoked.count > 0) return;

      const answered = await tx.canvasShareInvitation.findFirst({
        where: { id: shareId, canvasId },
        select: { id: true },
      });
      if (!answered) throw new NotFoundError("Share not found");
      throw new ConflictError(
        "Invitation was already answered; remove the collaborator from the share list",
      );
    });

    return NextResponse.json({
      success: true,
      message: "Share revoked successfully",
    });
  } catch (error) {
    return errorResponse(error, request.url);
  }
}
