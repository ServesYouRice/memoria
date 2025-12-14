import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { createLogger } from '@/lib/logger';
import { z } from 'zod';
import { withApiHandler } from '@/lib/api/route-handler';
import { notFoundError, forbiddenError, unauthorizedError } from '@/lib/errors';

const logger = createLogger('templates-api');

const updateTemplateSchema = z.object({
  name: z.string().min(1).optional(),
  description: z.string().optional(),
  category: z.string().optional(),
  isPublic: z.boolean().optional(),
  thumbnail: z.string().optional(),
});

interface RouteContext {
  params: Promise<{ templateId: string }>;
}

export const PUT = withApiHandler(async (req: NextRequest, { params }: RouteContext) => {
  const session = await auth();
  if (!session?.user?.id) {
    throw unauthorizedError();
  }

  const { templateId } = await params;
  const body = await req.json();
  const validation = updateTemplateSchema.safeParse(body);

  if (!validation.success) {
    return NextResponse.json({ error: 'Validation Error', details: validation.error.errors }, { status: 400 });
  }

  const { data } = validation;

  // Check existence and ownership
  const canvas = await prisma.canvas.findUnique({
    where: { id: templateId },
  });

  if (!canvas) {
    throw notFoundError('Template', templateId);
  }

  if (canvas.userId !== session.user.id) {
    throw forbiddenError();
  }

  if (!canvas.isTemplate) {
    // If updating a regular canvas to be a template? 
    // Usually via this endpoint we assume it IS a template or we are making it one?
    // Let's assume we update metadata.
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

  logger.info({ templateId, userId: session.user.id }, 'Template updated');

  return NextResponse.json(updatedCanvas);
});
