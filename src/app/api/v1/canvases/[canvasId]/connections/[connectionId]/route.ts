import { type NextRequest, NextResponse } from "next/server";
import { requireAuth, requireCanvasAccess } from "@/lib/api/auth";
import { prisma } from "@/lib/db";
import { z } from "zod";
import type { Prisma } from "@/generated/prisma/client";
import { withApiHandler } from "@/lib/api/route-handler";
import { NotFoundError } from "@/lib/errors";
import { lockCanvasForMutation } from "@/lib/canvas/mutation-lock";
import { recordCanvasItemEvent } from "@/lib/collaboration/committed-events";
import { invalidateCanvasCache } from "@/lib/cache/canvas-cache";
import {
  LINK_LABEL_MAX,
  LINK_STYLES,
  arrowsForLink,
} from "@/lib/canvas/arrow-links";
import { parseCanvasItemContent } from "@/lib/validation/canvas-item";
import { ItemType } from "@/types/canvas";

interface RouteParams {
  params: Promise<{ canvasId: string; connectionId: string }>;
}

const updateConnectionSchema = z.object({
  label: z.string().trim().max(LINK_LABEL_MAX).optional(),
  style: z.enum(LINK_STYLES).optional(),
});

function connectionJson(connection: {
  id: string;
  fromId: string;
  toId: string;
  label: string | null;
  style: string;
  createdAt: Date;
}) {
  return {
    id: connection.id,
    fromId: connection.fromId,
    toId: connection.toId,
    label: connection.label,
    style: connection.style,
    createdAt: connection.createdAt.toISOString(),
  };
}

/**
 * PATCH /api/v1/canvases/:canvasId/connections/:connectionId
 *
 * Relabel or restyle a link (IMP-095): label and line style live on the
 * link's arrows, and the link row follows them.
 */
export const PATCH = withApiHandler(
  async (request: NextRequest, { params }: RouteParams) => {
    const { userId, email } = await requireAuth();
    const { canvasId, connectionId } = await params;

    await requireCanvasAccess(canvasId, userId, email, "EDIT");
    const updates = updateConnectionSchema.parse(await request.json());

    const connection = await prisma.$transaction(async (tx) => {
      await lockCanvasForMutation(tx, canvasId);
      const existing = await tx.itemConnection.findFirst({
        where: { id: connectionId, canvasId },
      });
      if (!existing) throw new NotFoundError("Connection not found");

      if (updates.label !== undefined || updates.style !== undefined) {
        for (const arrow of await arrowsForLink(tx, existing)) {
          const content = { ...(arrow.content as Record<string, unknown>) };
          if (updates.label !== undefined) {
            if (updates.label) content.label = updates.label;
            else delete content.label;
          }
          if (updates.style !== undefined) {
            if (updates.style === "SOLID") delete content.lineStyle;
            else content.lineStyle = updates.style;
          }
          const updated = await tx.canvasItem.update({
            where: { id: arrow.id },
            data: {
              content: parseCanvasItemContent(
                ItemType.ARROW,
                content,
              ) as Prisma.InputJsonValue,
              updatedById: userId,
              version: { increment: 1 },
            },
          });
          await recordCanvasItemEvent(tx, {
            canvasId,
            actorId: userId,
            itemId: updated.id,
            version: updated.version,
            operation: "updated",
          });
        }
      }
      const fresh = await tx.itemConnection.findUnique({
        where: { id: connectionId },
      });
      if (!fresh) throw new NotFoundError("Connection not found");
      return fresh;
    });
    await invalidateCanvasCache(canvasId);
    return NextResponse.json(connectionJson(connection));
  },
);

/**
 * DELETE /api/v1/canvases/:canvasId/connections/:connectionId
 *
 * Unlink two items (IMP-095): the link's arrows go to the trash, where they
 * can be restored with the link, and the link row follows them.
 */
export const DELETE = withApiHandler(
  async (_request: NextRequest, { params }: RouteParams) => {
    const { userId, email } = await requireAuth();
    const { canvasId, connectionId } = await params;

    await requireCanvasAccess(canvasId, userId, email, "EDIT");

    await prisma.$transaction(async (tx) => {
      await lockCanvasForMutation(tx, canvasId);
      const existing = await tx.itemConnection.findFirst({
        where: { id: connectionId, canvasId },
      });
      if (!existing) throw new NotFoundError("Connection not found");
      for (const arrow of await arrowsForLink(tx, existing)) {
        const deleted = await tx.canvasItem.update({
          where: { id: arrow.id },
          data: {
            deletedAt: new Date(),
            deletedById: userId,
            archivedAt: null,
            version: { increment: 1 },
          },
        });
        await recordCanvasItemEvent(tx, {
          canvasId,
          actorId: userId,
          itemId: deleted.id,
          version: deleted.version,
          operation: "deleted",
        });
      }
      // A link no arrow backs (made before arrows were the record) goes too.
      await tx.itemConnection.deleteMany({ where: { id: connectionId } });
    });
    await invalidateCanvasCache(canvasId);

    return NextResponse.json({ success: true });
  },
);
