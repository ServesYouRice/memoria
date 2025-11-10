/**
 * Templates API
 * Manage canvas templates
 */

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth/auth-options';
import { prisma } from '@/lib/prisma';
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
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    throw new UnauthorizedError('You must be logged in to create templates');
  }

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

  if (canvas.userId !== session.user.id) {
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

  const where: any = {
    isTemplate: true,
  };

  if (category && category !== 'all') {
    where.templateCategory = category;
  }

  if (userId) {
    where.userId = userId;
  }

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
  });

  return NextResponse.json({ templates });
}
