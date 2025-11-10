/**
 * Canvas Items API Routes
 * POST /api/v1/canvas-items - Create a new canvas item (NOTE or BOOKMARK)
 * GET /api/v1/canvas-items?canvasId={id} - List canvas items
 *
 * Following ADR-0001: API Versioning & Error Contract
 * Following ADR-0009: Autosave & Concurrency Control
 */

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { requireAuth, requireCanvasOwnership } from '@/lib/api/auth';
import { errorResponse } from '@/lib/errors';
import { createCanvasItemSchema, listCanvasItemsSchema } from '@/lib/validation/canvas-item';

/**
 * POST /api/v1/canvas-items
 * Create a new canvas item (NOTE or BOOKMARK)
 */
export async function POST(request: NextRequest) {
  try {
    const { userId } = await requireAuth();
    const body = await request.json();

    // Validate input
    const data = createCanvasItemSchema.parse(body);

    // Verify canvas ownership
    await requireCanvasOwnership(data.canvasId, userId);

    // Create item
    const item = await prisma.canvasItem.create({
      data: {
        canvasId: data.canvasId,
        type: data.type,
        positionX: data.positionX,
        positionY: data.positionY,
        width: data.width,
        height: data.height,
        zIndex: data.zIndex,
        content: data.content as any, // Prisma Json type
        version: 1,
        createdById: userId,
        updatedById: userId,
      },
    });

    return NextResponse.json(item, { status: 201 });
  } catch (error) {
    return errorResponse(error, request.url);
  }
}

/**
 * GET /api/v1/canvas-items?canvasId={id}&type={NOTE|BOOKMARK}
 * List canvas items for a canvas
 */
export async function GET(request: NextRequest) {
  try {
    const { userId } = await requireAuth();
    const searchParams = request.nextUrl.searchParams;

    // Parse query params
    const query = listCanvasItemsSchema.parse({
      canvasId: searchParams.get('canvasId'),
      type: searchParams.get('type') || undefined,
      includeDeleted: searchParams.get('includeDeleted') === 'true',
    });

    // Verify canvas ownership
    await requireCanvasOwnership(query.canvasId, userId);

    // Fetch items
    const items = await prisma.canvasItem.findMany({
      where: {
        canvasId: query.canvasId,
        ...(query.type && { type: query.type }),
        ...(query.includeDeleted ? {} : { deletedAt: null }),
      },
      orderBy: [{ zIndex: 'asc' }, { createdAt: 'asc' }],
    });

    return NextResponse.json({ items });
  } catch (error) {
    return errorResponse(error, request.url);
  }
}
