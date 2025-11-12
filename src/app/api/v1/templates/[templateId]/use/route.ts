/**
 * Use Template API
 * Create a new canvas from a template
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/api/auth';
import { prisma } from '@/lib/db';
import { NotFoundError } from '@/lib/errors';

interface RouteContext {
  params: { templateId: string };
}

/**
 * POST /api/v1/templates/[templateId]/use
 * Create a new canvas from a template
 */
export async function POST(request: NextRequest, { params }: RouteContext) {
  const { userId } = await requireAuth();
  const { templateId } = params;

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
    throw new NotFoundError('Template not found');
  }

  // Create new canvas from template
  const newCanvas = await prisma.canvas.create({
    data: {
      name: `${template.name} (Copy)`,
      userId,
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
          content: item.content,
          tags: item.tags,
          createdById: userId,
        })),
      },
    },
    include: {
      items: true,
    },
  });

  // Increment usage count on template
  await prisma.canvas.update({
    where: { id: templateId },
    data: {
      usageCount: { increment: 1 },
    },
  });

  return NextResponse.json(newCanvas, { status: 201 });
}
