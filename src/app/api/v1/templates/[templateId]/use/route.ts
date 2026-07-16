/**
 * Use Template API
 * Create a new canvas from a template
 */

import { type NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { NotFoundError, UnauthorizedError, errorResponse } from "@/lib/errors";
import { type Prisma } from "@prisma/client";
import { invalidateCanvasCache } from "@/lib/cache/canvas-cache";

interface RouteContext {
  params: Promise<{ templateId: string }>;
}

/**
 * POST /api/v1/templates/[templateId]/use
 * Create a new canvas from a template
 */
export async function POST(_request: NextRequest, { params }: RouteContext) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      throw new UnauthorizedError("You must be logged in to use templates");
    }

    const { templateId } = await params;

    // Find the template
    const template = await prisma.canvas.findUnique({
      where: { id: templateId },
      include: {
        items: {
          where: { deletedAt: null },
        },
      },
    });

    if (!template || !template.isTemplate) {
      throw new NotFoundError("Template not found");
    }

    if (!template.isPublic && template.userId !== session.user.id) {
      throw new UnauthorizedError(
        "You do not have permission to use this template",
      );
    }

    // Create new canvas from template
    const newCanvas = await prisma.$transaction(async (tx) => {
      const created = await tx.canvas.create({
        data: {
          name: `${template.name} (Copy)`,
          userId: session.user.id,
          zoomLevel: template.zoomLevel,
          panX: template.panX,
          panY: template.panY,
          items: {
            create: template.items.map((item) => ({
              type: item.type,
              positionX: item.positionX,
              positionY: item.positionY,
              width: item.width,
              height: item.height,
              zIndex: item.zIndex,
              content: item.content as Prisma.InputJsonValue,
              tags: item.tags,
              createdBy: { connect: { id: session.user.id } },
            })),
          },
        },
        include: { items: true },
      });
      await tx.canvas.update({
        where: { id: templateId },
        data: { usageCount: { increment: 1 } },
      });
      return created;
    });

    await invalidateCanvasCache(templateId);

    return NextResponse.json(newCanvas, { status: 201 });
  } catch (error) {
    return errorResponse(error, _request.url);
  }
}
