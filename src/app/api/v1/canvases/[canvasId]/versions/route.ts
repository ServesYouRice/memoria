/**
 * Canvas Versions API
 * Manage canvas version history
 */

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-options';
import { prisma } from '@/lib/db';
import { z } from 'zod';
import { NotFoundError, UnauthorizedError, ValidationError } from '@/lib/errors';

interface RouteContext {
  params: { canvasId: string };
}

const createVersionSchema = z.object({
  name: z.string().min(1).max(100).optional(),
});

/**
 * POST /api/v1/canvases/[canvasId]/versions
 * Create a new version snapshot
 */
export async function POST(request: NextRequest, { params }: RouteContext) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    throw new UnauthorizedError('You must be logged in');
  }

  const { canvasId } = params;

  const body = await request.json();
  const validation = createVersionSchema.safeParse(body);
  if (!validation.success) {
    throw new ValidationError(validation.error.errors[0].message);
  }

  const { name } = validation.data;

  // Verify canvas ownership
  const canvas = await prisma.canvas.findUnique({
    where: { id: canvasId },
    include: {
      items: {
        where: { deletedAt: null },
      },
    },
  });

  if (!canvas) {
    throw new NotFoundError('Canvas not found');
  }

  if (canvas.userId !== session.user.id) {
    throw new UnauthorizedError('You can only create versions of your own canvases');
  }

  // Create snapshot
  const snapshot = {
    name: canvas.name,
    zoomLevel: canvas.zoomLevel,
    panX: canvas.panX,
    panY: canvas.panY,
    items: canvas.items.map((item) => ({
      type: item.type,
      positionX: item.positionX,
      positionY: item.positionY,
      width: item.width,
      height: item.height,
      zIndex: item.zIndex,
      content: item.content,
      tags: item.tags,
    })),
  };

  const versionName = name || `Version ${new Date().toLocaleString()}`;

  const version = await prisma.canvasVersion.create({
    data: {
      canvasId,
      name: versionName,
      snapshot,
    },
  });

  return NextResponse.json(version, { status: 201 });
}

/**
 * GET /api/v1/canvases/[canvasId]/versions
 * List all versions for a canvas
 */
export async function GET(request: NextRequest, { params }: RouteContext) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    throw new UnauthorizedError('You must be logged in');
  }

  const { canvasId } = params;

  // Verify canvas ownership
  const canvas = await prisma.canvas.findUnique({
    where: { id: canvasId },
  });

  if (!canvas) {
    throw new NotFoundError('Canvas not found');
  }

  if (canvas.userId !== session.user.id) {
    throw new UnauthorizedError('You can only view versions of your own canvases');
  }

  const versions = await prisma.canvasVersion.findMany({
    where: { canvasId },
    orderBy: { createdAt: 'desc' },
    select: {
      id: true,
      name: true,
      createdAt: true,
    },
  });

  return NextResponse.json({ versions });
}
