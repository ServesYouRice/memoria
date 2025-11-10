/**
 * Canvas Items API Routes
 * POST /api/v1/canvas-items - Create a new canvas item (NOTE or BOOKMARK)
 * GET /api/v1/canvas-items?canvasId={id} - List canvas items
 *   Optional viewport-based pagination:
 *   ?minX=0&maxX=1000&minY=0&maxY=1000&limit=100&offset=0
 *
 * Following ADR-0001: API Versioning & Error Contract
 * Following ADR-0009: Autosave & Concurrency Control
 */

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { requireAuth, requireCanvasOwnership } from '@/lib/api/auth';
import { errorResponse } from '@/lib/errors';
import { createCanvasItemSchema, listCanvasItemsSchema, viewportPaginationSchema } from '@/lib/validation/canvas-item';

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
 *
 * Supports viewport-based pagination:
 * - If minX, maxX, minY, maxY are provided: filters items by viewport intersection
 * - If viewport params are omitted: returns all items (backwards compatible)
 *
 * Pagination parameters:
 * - limit: max items to return (default 100, max 1000)
 * - offset: skip n items (default 0)
 *
 * Performance:
 * - Uses canvasId index for fast canvas filtering
 * - Uses deletedAt index for soft delete filtering
 * - Viewport filtering is done in memory (Prisma limitation),
 *   but the combination of canvasId+deletedAt index pre-filters efficiently
 */
export async function GET(request: NextRequest) {
  try {
    const { userId } = await requireAuth();
    const searchParams = request.nextUrl.searchParams;

    // Check if viewport parameters are provided
    const hasViewportParams =
      searchParams.has('minX') ||
      searchParams.has('maxX') ||
      searchParams.has('minY') ||
      searchParams.has('maxY');

    // Parse query params with viewport support
    const query = hasViewportParams
      ? viewportPaginationSchema.parse({
          canvasId: searchParams.get('canvasId'),
          type: searchParams.get('type') || undefined,
          includeDeleted: searchParams.get('includeDeleted') === 'true',
          minX: searchParams.has('minX') ? parseFloat(searchParams.get('minX')!) : undefined,
          maxX: searchParams.has('maxX') ? parseFloat(searchParams.get('maxX')!) : undefined,
          minY: searchParams.has('minY') ? parseFloat(searchParams.get('minY')!) : undefined,
          maxY: searchParams.has('maxY') ? parseFloat(searchParams.get('maxY')!) : undefined,
          limit: searchParams.has('limit') ? parseInt(searchParams.get('limit')!, 10) : 100,
          offset: searchParams.has('offset') ? parseInt(searchParams.get('offset')!, 10) : 0,
        })
      : listCanvasItemsSchema.parse({
          canvasId: searchParams.get('canvasId'),
          type: searchParams.get('type') || undefined,
          includeDeleted: searchParams.get('includeDeleted') === 'true',
        });

    // Verify canvas ownership
    await requireCanvasOwnership(query.canvasId, userId);

    // Base where clause (always applied)
    const baseWhere = {
      canvasId: query.canvasId,
      ...(query.type && { type: query.type }),
      ...(query.includeDeleted ? {} : { deletedAt: null }),
    };

    // Fetch items
    let items = await prisma.canvasItem.findMany({
      where: baseWhere,
      orderBy: [{ zIndex: 'asc' }, { createdAt: 'asc' }],
    });

    // Apply viewport filtering if viewport parameters are provided
    if (hasViewportParams) {
      const { minX, maxX, minY, maxY, limit, offset } = query as any;

      // Filter items that intersect with viewport bounds
      // Intersection algorithm:
      // (item.positionX + item.width) >= minX  &&  // item right edge >= viewport left
      // item.positionX <= maxX                 &&  // item left edge <= viewport right
      // (item.positionY + item.height) >= minY &&  // item bottom edge >= viewport top
      // item.positionY <= maxY                     // item top edge <= viewport bottom
      items = items.filter((item) => {
        const itemRight = item.positionX + item.width;
        const itemBottom = item.positionY + item.height;

        return (
          itemRight >= minX &&
          item.positionX <= maxX &&
          itemBottom >= minY &&
          item.positionY <= maxY
        );
      });

      // Apply offset and limit
      const total = items.length;
      items = items.slice(offset, offset + limit);

      // Return with pagination metadata
      return NextResponse.json({ items, total, offset, limit });
    }

    // Backwards compatible response (no viewport params)
    return NextResponse.json({ items });
  } catch (error) {
    return errorResponse(error, request.url);
  }
}
