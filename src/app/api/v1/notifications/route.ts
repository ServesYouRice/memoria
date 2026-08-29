import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAuth } from "@/lib/api/auth";
import { withApiHandler } from "@/lib/api/route-handler";
import { parsePagination } from "@/lib/api/pagination";
import { prisma } from "@/lib/db";
import { decryptSecret } from "@/lib/agents/crypto";

const markReadSchema = z.union([
  z.object({ ids: z.array(z.string().cuid()).min(1).max(100) }).strict(),
  z.object({ all: z.literal(true) }).strict(),
]);

export const GET = withApiHandler(async (request: Request) => {
  const { userId, email } = await requireAuth();
  const { searchParams } = new URL(request.url);
  const { limit, offset } = parsePagination(searchParams, {
    defaultLimit: 50,
    maxLimit: 100,
  });
  const where = { recipientId: userId };
  const [notifications, total, unread] = await Promise.all([
    prisma.notification.findMany({
      where,
      include: {
        actor: { select: { id: true, name: true, image: true } },
        canvas: { select: { id: true, name: true } },
      },
      orderBy: { createdAt: "desc" },
      take: limit,
      skip: offset,
    }),
    prisma.notification.count({ where }),
    prisma.notification.count({ where: { ...where, readAt: null } }),
  ]);
  const invitationCanvasIds = notifications
    .filter(
      (notification) =>
        notification.type === "CANVAS_SHARED" && notification.canvasId,
    )
    .map((notification) => notification.canvasId as string);
  const invitations =
    invitationCanvasIds.length > 0
      ? await prisma.canvasShareInvitation.findMany({
          where: {
            canvasId: { in: invitationCanvasIds },
            email: email.toLowerCase(),
            respondedAt: null,
            expiresAt: { gt: new Date() },
          },
          select: { canvasId: true, deliverySecret: true },
          orderBy: { createdAt: "desc" },
        })
      : [];
  const invitationActionByCanvas = new Map<string, string>();
  for (const invitation of invitations) {
    if (invitationActionByCanvas.has(invitation.canvasId)) continue;
    try {
      invitationActionByCanvas.set(
        invitation.canvasId,
        `/share-invitations/${decryptSecret(invitation.deliverySecret)}`,
      );
    } catch {
      // A damaged delivery secret must not make the entire inbox unavailable.
      // The invitation can still be acted on from a valid email delivery.
    }
  }

  const inbox = notifications.map((notification) => {
    const invitationHref = notification.canvasId
      ? invitationActionByCanvas.get(notification.canvasId)
      : undefined;
    const action = invitationHref
      ? { href: invitationHref, label: "Review invitation" }
      : notification.canvasId && notification.type !== "CANVAS_SHARED"
        ? {
            href: `/canvas/${notification.canvasId}`,
            label: "Open canvas",
          }
        : null;
    return { ...notification, action };
  });

  return NextResponse.json({
    notifications: inbox,
    unread,
    pagination: { total, limit, offset },
  });
});

export const PATCH = withApiHandler(async (request: Request) => {
  const { userId } = await requireAuth();
  const input = markReadSchema.parse(await request.json());
  const result = await prisma.notification.updateMany({
    where: {
      recipientId: userId,
      readAt: null,
      ...("ids" in input ? { id: { in: input.ids } } : {}),
    },
    data: { readAt: new Date() },
  });
  return NextResponse.json({ updated: result.count });
});
