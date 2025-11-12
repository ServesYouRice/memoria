/**
 * Individual Template API
 * Manage specific templates
 */

import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { NotFoundError, UnauthorizedError } from '@/lib/errors';

interface RouteContext {
  params: { templateId: string };
}

/**
 * GET /api/v1/templates/[templateId]
 * Get a specific template
 */
export async function GET(request: NextRequest, { params }: RouteContext) {
  const { templateId } = params;

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
          email: true,
        },
      },
    },
  });

  if (!template || !template.isTemplate) {
    throw new NotFoundError('Template not found');
  }

  return NextResponse.json(template);
}

/**
 * DELETE /api/v1/templates/[templateId]
 * Remove template status from a canvas (doesn't delete canvas)
 */
export async function DELETE(request: NextRequest, { params }: RouteContext) {
  const session = await auth();
  if (!session?.user?.id) {
    throw new UnauthorizedError('You must be logged in');
  }

  const { templateId } = params;

  // Find template and verify ownership
  const template = await prisma.canvas.findUnique({
    where: { id: templateId },
  });

  if (!template) {
    throw new NotFoundError('Template not found');
  }

  if (template.userId !== session.user.id) {
    throw new UnauthorizedError('You can only modify your own templates');
  }

  // Remove template status
  const updatedCanvas = await prisma.canvas.update({
    where: { id: templateId },
    data: {
      isTemplate: false,
      templateDescription: null,
      templateCategory: null,
    },
  });

  return NextResponse.json({ success: true, canvas: updatedCanvas });
}
