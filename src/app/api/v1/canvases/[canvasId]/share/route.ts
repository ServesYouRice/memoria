import { randomBytes } from "node:crypto";
import { type NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { requireAuth } from "@/lib/api/auth";
import { errorResponse, ForbiddenError } from "@/lib/errors";
import { assertCanvasShareCapacity } from "@/lib/policy/capacity";
import { encryptSecret, fingerprintSecret } from "@/lib/agents/crypto";
import { enqueueOutboxJob } from "@/lib/outbox/enqueue";
import { withApiHandler } from "@/lib/api/route-handler";

const INVITATION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const shareCanvasSchema = z.object({
  email: z
    .string()
    .trim()
    .email()
    .transform((email) => email.toLowerCase()),
  role: z.enum(["VIEW", "COMMENT", "EDIT"]).default("VIEW"),
});

interface RouteContext {
  params: Promise<{ canvasId: string }>;
}

export const POST = withApiHandler(
  async (request: NextRequest, { params }: RouteContext) => {
    try {
      const { userId, email: actorEmail } = await requireAuth();
      const { canvasId } = await params;
      const data = shareCanvasSchema.parse(await request.json());
      if (data.email === actorEmail.toLowerCase()) {
        throw new ForbiddenError("Cannot share canvas with yourself");
      }

      const rawToken = randomBytes(32).toString("base64url");
      const expiresAt = new Date(Date.now() + INVITATION_TTL_MS);
      await prisma.$transaction(async (tx) => {
        const canvas = await tx.canvas.findUnique({
          where: { id: canvasId },
          select: { userId: true },
        });
        if (!canvas || canvas.userId !== userId) {
          throw new ForbiddenError(
            "You do not have permission to share this canvas",
          );
        }

        await assertCanvasShareCapacity(tx, canvasId, data.email);
        await tx.canvasShareInvitation.updateMany({
          where: { canvasId, email: data.email, respondedAt: null },
          data: { respondedAt: new Date(), response: "REVOKED" },
        });
        const invitation = await tx.canvasShareInvitation.create({
          data: {
            canvasId,
            invitedById: userId,
            email: data.email,
            role: data.role,
            tokenHash: fingerprintSecret(rawToken),
            deliverySecret: encryptSecret(rawToken),
            expiresAt,
          },
        });
        const recipient = await tx.user.findUnique({
          where: { email: data.email },
          select: { id: true },
        });
        if (recipient) {
          const preference = await tx.notificationPreference.findUnique({
            where: {
              userId_type: { userId: recipient.id, type: "CANVAS_SHARED" },
            },
            select: { inAppEnabled: true },
          });
          if (preference?.inAppEnabled !== false) {
            await tx.notification.create({
              data: {
                recipientId: recipient.id,
                actorId: userId,
                canvasId,
                type: "CANVAS_SHARED",
                subject: "You were invited to a canvas",
              },
            });
          }
        }
        await enqueueOutboxJob(tx, {
          type: "email.share-invitation",
          payload: { invitationId: invitation.id },
          dedupeKey: `email.share-invitation:${invitation.id}`,
        });
      });

      return NextResponse.json(
        {
          message:
            "If the address can receive invitations, delivery has been queued.",
        },
        { status: 202 },
      );
    } catch (error) {
      return errorResponse(error, request.url);
    }
  },
);

export const GET = withApiHandler(
  async (request: NextRequest, { params }: RouteContext) => {
    try {
      const { userId } = await requireAuth();
      const { canvasId } = await params;
      const canvas = await prisma.canvas.findUnique({
        where: { id: canvasId },
        select: { userId: true },
      });
      if (!canvas || canvas.userId !== userId) {
        throw new ForbiddenError(
          "You do not have permission to view shares for this canvas",
        );
      }
      const [shares, invitations] = await Promise.all([
        prisma.canvasShare.findMany({
          where: { canvasId, recipientId: { not: null } },
          orderBy: { createdAt: "desc" },
        }),
        prisma.canvasShareInvitation.findMany({
          where: { canvasId, respondedAt: null, expiresAt: { gt: new Date() } },
          select: {
            id: true,
            email: true,
            role: true,
            expiresAt: true,
            createdAt: true,
          },
          orderBy: { createdAt: "desc" },
        }),
      ]);
      return NextResponse.json({ shares, invitations });
    } catch (error) {
      return errorResponse(error, request.url);
    }
  },
);
