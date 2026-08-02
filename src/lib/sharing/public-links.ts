import { nanoid } from "nanoid";
import type { PrismaClient } from "@/generated/prisma/client";
import { BadRequestError, ForbiddenError } from "@/lib/errors";

async function requireOwnedCanvas(
  prisma: PrismaClient,
  canvasId: string,
  userId: string,
) {
  const canvas = await prisma.canvas.findFirst({
    where: { id: canvasId, userId },
  });
  if (!canvas) throw new ForbiddenError("You do not own this canvas");
  return canvas;
}

export async function enablePublicCanvas(
  prisma: PrismaClient,
  canvasId: string,
  userId: string,
) {
  await requireOwnedCanvas(prisma, canvasId, userId);
  const token = nanoid(16);
  await prisma.canvas.updateMany({
    where: {
      id: canvasId,
      userId,
      OR: [{ isPublic: false }, { shareToken: null }],
    },
    data: { isPublic: true, shareToken: token },
  });
  return requireOwnedCanvas(prisma, canvasId, userId);
}

export async function disablePublicCanvas(
  prisma: PrismaClient,
  canvasId: string,
  userId: string,
) {
  await requireOwnedCanvas(prisma, canvasId, userId);
  return prisma.canvas.update({
    where: { id: canvasId },
    data: { isPublic: false, shareToken: null },
  });
}

export async function rotatePublicCanvasLink(
  prisma: PrismaClient,
  canvasId: string,
  userId: string,
) {
  return prisma.$transaction(async (tx) => {
    const canvas = await tx.canvas.findFirst({
      where: { id: canvasId, userId },
    });
    if (!canvas) throw new ForbiddenError("You do not own this canvas");
    if (!canvas.isPublic) {
      throw new BadRequestError(
        "Public sharing must be enabled before rotating the link",
      );
    }
    const updated = await tx.canvas.update({
      where: { id: canvasId },
      data: { shareToken: nanoid(16) },
    });
    await tx.activity.create({
      data: {
        userId,
        type: "CANVAS_SHARED",
        canvasId,
        canvasName: canvas.name,
        metadata: { action: "public_link_rotated" },
      },
    });
    return updated;
  });
}
