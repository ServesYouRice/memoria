/**
 * Templates API
 * Manage canvas templates
 */

import { type NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { z } from 'zod';
import { UnauthorizedError, ValidationError } from '@/lib/errors';
import { invalidateCanvasCache } from '@/lib/cache/canvas-cache';
import { requireAuth } from '@/lib/api/auth';
import { withApiHandler } from '@/lib/api/route-handler';
import {
  MAX_TEMPLATE_DESCRIPTION_LENGTH,
  MAX_CATEGORY_NAME_LENGTH,
  DEFAULT_PAGE_LIMIT,
  MAX_PAGE_LIMIT,
} from '@/lib/constants';

const saveAsTemplateSchema = z.object({
  canvasId: z.string().cuid(),
  description: z.string().min(1).max(MAX_TEMPLATE_DESCRIPTION_LENGTH).optional(),
  category: z.string().min(1).max(MAX_CATEGORY_NAME_LENGTH).optional(),
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
    throw new ValidationError(validation.error.errors[0]?.message || 'Validation error');
  }

  const { canvasId, description, category } = validation.data;

  // Verify canvas ownership
  const canvas = await prisma.canvas.findUnique({
    where: { id: canvasId },
    include: { items: true },
  });

  if (!canvas) {
    throw new ValidationError('Canvas not found');
  }

  if (canvas.userId !== userId) {
    throw new UnauthorizedError('You can only create templates from your own canvases');
  }

  // Update canvas to be a template
  const template = await prisma.canvas.update({
    where: { id: canvasId },
    data: {
      isTemplate: true,
      templateDescription: description,
      templateCategory: category || 'General',
    },
    include: {
      items: true,
      user: {
        select: {
          id: true,
          name: true,
          email: true,
        },
      },
    },
  });

  await invalidateCanvasCache(canvasId);

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
  const { searchParams } = new URL(request.url);
  const category = searchParams.get('category');
  const userId = searchParams.get('userId'); // Optional: filter by user

  // Pagination parameters with sensible defaults
  const limit = Math.min(
    parseInt(searchParams.get('limit') || String(DEFAULT_PAGE_LIMIT), 10),
    MAX_PAGE_LIMIT
  );
  const offset = parseInt(searchParams.get('offset') || '0', 10);

  const where: any = {
    isTemplate: true,
  };

  if (category && category !== 'all') {
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
          email: true,
        },
      },
    },
    orderBy: [
      { usageCount: 'desc' },
      { createdAt: 'desc' },
    ],
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
