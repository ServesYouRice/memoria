import { type NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { requireAuth } from "@/lib/api/auth";
import { errorResponse, ForbiddenError, NotFoundError } from "@/lib/errors";
import { fingerprintSecret } from "@/lib/agents/crypto";
import { enqueueOutboxJob } from "@/lib/outbox/enqueue";

const responseSchema = z
  .object({ action: z.enum(["accept", "decline"]) })
  .strict();

interface RouteContext {
  params: Promise<{ token: string }>;
}

export async function POST(request: NextRequest, { params }: RouteContext) {
  try {
    const { userId } = await requireAuth();
    const { token } = await params;
    const { action } = responseSchema.parse(await request.json());
    const tokenHash = fingerprintSecret(token);

    const result = await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT 1 FROM "CanvasShareInvitation" WHERE "tokenHash" = ${tokenHash} FOR UPDATE`;
      const [invitation, user] = await Promise.all([
        tx.canvasShareInvitation.findUnique({
          where: { tokenHash },
          include: { canvas: { select: { name: true } } },
        }),
        tx.user.findUnique({
          where: { id: userId },
          select: { email: true, emailVerified: true },
        }),
      ]);
      if (
        !invitation ||
        invitation.respondedAt ||
        invitation.expiresAt <= new Date()
      ) {
        throw new NotFoundError("Invitation is unavailable");
      }
      if (
        !user?.emailVerified ||
        user.email.toLowerCase() !== invitation.email.toLowerCase()
      ) {
        throw new ForbiddenError("Invitation is unavailable");
      }

      const response = action === "accept" ? "ACCEPTED" : "DECLINED";
      await tx.canvasShareInvitation.update({
        where: { id: invitation.id },
        data: { respondedAt: new Date(), response },
      });
      if (action === "accept") {
        const existingShare = await tx.canvasShare.findFirst({
          where: {
            canvasId: invitation.canvasId,
            OR: [{ recipientId: userId }, { email: invitation.email }],
          },
          select: { id: true },
        });
        const data = {
          email: invitation.email,
          recipientId: userId,
          role: invitation.role,
        };
        if (existingShare) {
          await tx.canvasShare.update({
            where: { id: existingShare.id },
            data,
          });
        } else {
          await tx.canvasShare.create({
            data: {
              canvasId: invitation.canvasId,
              ...data,
            },
          });
        }
      }
      const notificationType =
        action === "accept"
          ? "SHARE_INVITATION_ACCEPTED"
          : "SHARE_INVITATION_DECLINED";
      const preference = await tx.notificationPreference.findUnique({
        where: {
          userId_type: {
            userId: invitation.invitedById,
            type: notificationType,
          },
        },
        select: { inAppEnabled: true },
      });
      if (preference?.inAppEnabled !== false) {
        await tx.notification.create({
          data: {
            recipientId: invitation.invitedById,
            actorId: userId,
            canvasId: invitation.canvasId,
            type: notificationType,
            subject: `${invitation.email} ${action === "accept" ? "accepted" : "declined"} the invitation`,
          },
        });
      }
      await enqueueOutboxJob(tx, {
        type: "email.share-decision",
        payload: { invitationId: invitation.id },
        dedupeKey: `email.share-decision:${invitation.id}:${response}`,
      });
      return {
        action,
        canvasId: invitation.canvasId,
        canvasName: invitation.canvas.name,
      };
    });

    return NextResponse.json(result);
  } catch (error) {
    return errorResponse(error, request.url);
  }
}
