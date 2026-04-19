/**
 * Templates API
 * Manage canvas templates
 */

import { type NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { z } from "zod";
import { UnauthorizedError, ValidationError } from "@/lib/errors";
import { requireAuth } from "@/lib/api/auth";
import { withApiHandler } from "@/lib/api/route-handler";
import {
  MAX_TEMPLATE_DESCRIPTION_LENGTH,
  MAX_CATEGORY_NAME_LENGTH,
  DEFAULT_PAGE_LIMIT,
  MAX_PAGE_LIMIT,
} from "@/lib/constants";

const saveAsTemplateSchema = z.object({
  canvasId: z.string().cuid(),
  name: z.string().min(1).max(100).optional(),
  description: z
    .string()
    .min(1)
    .max(MAX_TEMPLATE_DESCRIPTION_LENGTH)
    .optional(),
  category: z.string().min(1).max(MAX_CATEGORY_NAME_LENGTH).optional(),
  isPublic: z.boolean().optional(),
});

/**
 * POST /api/v1/templates
 * Save a canvas as a template
 */
export const POST = withApiHandler(async (request: NextRequest) => {
  const { userId } = await requireAuth();

  const body = await request.json();
  const validation = saveAsTemplateSchema.safeParse(body);
  if (!validation.success) {
    throw new ValidationError(
      validation.error.errors[0]?.message || "Validation error",
    );
  }

  const { canvasId, name, description, category, isPublic } = validation.data;

  // Verify canvas ownership
  const canvas = await prisma.canvas.findUnique({
    where: { id: canvasId },
    include: { items: true },
  });

  if (!canvas) {
    throw new ValidationError("Canvas not found");
  }

  if (canvas.userId !== userId) {
    throw new UnauthorizedError(
      "You can only create templates from your own canvases",
    );
  }

  const template = await prisma.$transaction(async (tx) => {
    const createdTemplate = await tx.canvas.create({
      data: {
        name: name || `${canvas.name} Template`,
        userId,
        zoomLevel: canvas.zoomLevel,
        panX: canvas.panX,
        panY: canvas.panY,
        thumbnail: canvas.thumbnail,
        isTemplate: true,
        isPublic: isPublic ?? false,
        templateDescription: description,
        templateCategory: category || "General",
      },
    });

    const activeItems = canvas.items.filter((item) => item.deletedAt === null);
    if (activeItems.length > 0) {
      await tx.canvasItem.createMany({
        data: activeItems.map((item) => ({
          canvasId: createdTemplate.id,
          type: item.type,
          positionX: item.positionX,
          positionY: item.positionY,
          width: item.width,
          height: item.height,
          zIndex: item.zIndex,
          content: (item.content ?? Prisma.JsonNull) as Prisma.InputJsonValue,
          tags: item.tags,
          version: 1,
          createdById: userId,
          updatedById: userId,
        })),
      });
    }

    return tx.canvas.findUnique({
      where: { id: createdTemplate.id },
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
  });

  return NextResponse.json(template, { status: 200 });
});

/**
 * GET /api/v1/templates
 * List all public templates (from any user)
 *
 * Query parameters:
 * - category: Filter by template category
 * - userId: Filter by template creator
 * - limit: Number of templates to return (default: 50, max: 100)
 * - offset: Number of templates to skip (default: 0)
 *
 * FIXED: Issue #16 - Added pagination limits to prevent fetching thousands of templates
 */
export const GET = withApiHandler(async (request: NextRequest) => {
  const session = await auth();
  const { searchParams } = new URL(request.url);
  const category = searchParams.get("category");
  const userId = searchParams.get("userId"); // Optional: filter by user

  // Pagination parameters with sensible defaults
  const limit = Math.min(
    parseInt(searchParams.get("limit") || String(DEFAULT_PAGE_LIMIT), 10),
    MAX_PAGE_LIMIT,
  );
  const offset = parseInt(searchParams.get("offset") || "0", 10);

  const visibilityFilter = session?.user?.id
    ? {
        OR: [{ isPublic: true }, { userId: session.user.id }],
      }
    : {
        isPublic: true,
      };

  const where: any = {
    isTemplate: true,
    ...visibilityFilter,
  };

  if (category && category !== "all") {
    where.templateCategory = category;
  }

  if (userId) {
    where.userId = userId;
  }

  // Get total count for pagination metadata
  const total = await prisma.canvas.count({ where });

  // Fetch templates with pagination
  const templates = await prisma.canvas.findMany({
    where,
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
    orderBy: [{ usageCount: "desc" }, { createdAt: "desc" }],
    take: limit,
    skip: offset,
  });

  return NextResponse.json({
    templates,
    pagination: {
      total,
      limit,
      offset,
      hasMore: offset + limit < total,
    },
  });
});
