import { type NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { createLogger } from "@/lib/logger";
import { z } from "zod";
import { withApiHandler } from "@/lib/api/route-handler";
import {
  fromZodError,
  notFoundError,
  forbiddenError,
  unauthorizedError,
} from "@/lib/errors";
import { invalidateCanvasCache } from "@/lib/cache/canvas-cache";

const logger = createLogger("templates-api");

const updateTemplateSchema = z.object({
  name: z.string().trim().min(1).max(200).optional(),
  description: z.string().trim().max(2000).optional(),
  category: z.string().trim().max(100).optional(),
  isPublic: z.boolean().optional(),
  thumbnail: z
    .string()
    .max(300_000)
    .regex(/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/)
    .optional(),
});

interface RouteContext {
  params: Promise<{ templateId: string }>;
}

export const GET = withApiHandler(
  async (_req: NextRequest, { params }: RouteContext) => {
    const session = await auth();
    const { templateId } = await params;

    const template = await prisma.canvas.findUnique({
      where: { id: templateId },
      include: {
        items: {
          where: { deletedAt: null },
        },
        user: {
          select: {
            id: true,
            name: true,
          },
        },
      },
    });

    if (!template || !template.isTemplate) {
      throw notFoundError("Template", templateId);
    }

    if (!template.isPublic && template.userId !== session?.user?.id) {
      throw forbiddenError();
    }

    return NextResponse.json(template);
  },
);

export const PUT = withApiHandler(
  async (req: NextRequest, { params }: RouteContext) => {
    const session = await auth();
    if (!session?.user?.id) {
      throw unauthorizedError();
    }

    const { templateId } = await params;
    const body = await req.json();
    const validation = updateTemplateSchema.safeParse(body);

    if (!validation.success) {
      throw fromZodError(validation.error);
    }

    const { data } = validation;

    // Check existence and ownership
    const canvas = await prisma.canvas.findUnique({
      where: { id: templateId },
    });

    if (!canvas) {
      throw notFoundError("Template", templateId);
    }

    if (!canvas.isTemplate) {
      throw notFoundError("Template", templateId);
    }

    if (canvas.userId !== session.user.id) {
      throw forbiddenError();
    }

    const updatedCanvas = await prisma.canvas.update({
      where: { id: templateId },
      data: {
        name: data.name,
        templateDescription: data.description,
        templateCategory: data.category,
        isPublic: data.isPublic,
        thumbnail: data.thumbnail,
        updatedAt: new Date(),
      },
    });

    logger.info({ templateId, userId: session.user.id }, "Template updated");

    await invalidateCanvasCache(templateId);

    return NextResponse.json(updatedCanvas);
  },
);

export const DELETE = withApiHandler(
  async (_req: NextRequest, { params }: RouteContext) => {
    const session = await auth();
    if (!session?.user?.id) {
      throw unauthorizedError();
    }

    const { templateId } = await params;

    const canvas = await prisma.canvas.findUnique({
      where: { id: templateId },
    });

    if (!canvas) {
      throw notFoundError("Template", templateId);
    }

    if (!canvas.isTemplate) {
      throw notFoundError("Template", templateId);
    }

    if (canvas.userId !== session.user.id) {
      throw forbiddenError();
    }

    const updated = await prisma.canvas.update({
      where: { id: templateId },
      data: {
        isTemplate: false,
        templateDescription: null,
        templateCategory: null,
        isPublic: false,
      },
    });

    await invalidateCanvasCache(templateId);

    return NextResponse.json(updated);
  },
);
