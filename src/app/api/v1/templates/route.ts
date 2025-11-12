/**
 * Templates API
 * Manage canvas templates
 */

import { NextRequest, NextResponse } from 'next/server';
import { Prisma } from '@prisma/client';
import { requireAuth } from '@/lib/api/auth';
import { prisma } from '@/lib/db';
import { z } from 'zod';
import { UnauthorizedError, ValidationError } from '@/lib/errors';

const saveAsTemplateSchema = z.object({
  canvasId: z.string().cuid(),
  description: z.string().min(1).max(500).optional(),
  category: z.string().min(1).max(50).optional(),
});

/**
 * POST /api/v1/templates
 * Save a canvas as a template
 */
export async function POST(request: NextRequest) {
  const { userId } = await requireAuth();

  const body = await request.json();
  const validation = saveAsTemplateSchema.safeParse(body);
  if (!validation.success) {
    throw new ValidationError(validation.error.errors[0].message);
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

  return NextResponse.json(template, { status: 200 });
}

/**
 * GET /api/v1/templates
 * List all public templates (from any user)
 */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const category = searchParams.get('category');
  const userId = searchParams.get('userId'); // Optional: filter by user

  const where: Prisma.CanvasWhereInput = {
    isTemplate: true,
    ...(category && category !== 'all' && { templateCategory: category }),
    ...(userId && { userId }),
  };

  const templates = await prisma.canvas.findMany({
    where,
    select: {
      id: true,
      title: true,
      userId: true,
      isTemplate: true,
      templateDescription: true,
      templateCategory: true,
      usageCount: true,
      createdAt: true,
      updatedAt: true,
      items: {
        where: { deletedAt: null },
        select: {
          id: true,
          type: true,
          positionX: true,
          positionY: true,
          width: true,
          height: true,
          zIndex: true,
          content: true,
          tags: true,
        },
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
  });

  return NextResponse.json({ templates });
}
