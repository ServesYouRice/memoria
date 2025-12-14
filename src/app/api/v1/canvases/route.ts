import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { z } from 'zod';
import { DEFAULT_PAGE_LIMIT, MAX_PAGE_LIMIT } from '@/lib/constants';
import { withApiHandler } from '@/lib/api/route-handler';

/**
 * GET /api/v1/canvases
 *
 * Fetch canvases for the authenticated user
 * Per ADR-0001: API Versioning & Error Contract (RFC 7807)
 */
export const GET = withApiHandler(async (request: NextRequest) => {
  // Authentication check
  const session = await auth();
  if (!session?.user?.id) {
    throw new Error('Unauthorized: You must be logged in to access this resource');
  }

  // Pagination parameters
  const { searchParams } = new URL(request.url);
  const limit = Math.min(
    parseInt(searchParams.get('limit') || String(DEFAULT_PAGE_LIMIT), 10),
    MAX_PAGE_LIMIT
  );
  const offset = parseInt(searchParams.get('offset') || '0', 10);

  const where = { userId: session.user.id };

  // Get total count
  const total = await prisma.canvas.count({ where });

  // Fetch canvases with pagination
  const canvases = await prisma.canvas.findMany({
    where,
    orderBy: {
      updatedAt: 'desc',
    },
    take: limit,
    skip: offset,
  });

  return NextResponse.json({
    canvases,
    pagination: {
      total,
      limit,
      offset,
      hasMore: offset + limit < total,
    },
  });
});

const createCanvasSchema = z.object({
  name: z.string().min(1).max(255).optional().default('Untitled Canvas'),
});

/**
 * POST /api/v1/canvases
 *
 * Create a new canvas for the authenticated user
 * Per ADR-0001: API Versioning & Error Contract (RFC 7807)
 */
export const POST = withApiHandler(async (request: NextRequest) => {
  // Authentication check
  const session = await auth();
  if (!session?.user?.id) {
    throw new Error('Unauthorized: You must be logged in to access this resource');
  }

  // Parse and validate request body
  // ZodError will be caught automatically by withApiHandler
  const body = await request.json();
  const validatedData = createCanvasSchema.parse(body);

  // Create canvas
  const canvas = await prisma.canvas.create({
    data: {
      name: validatedData.name,
      userId: session.user.id,
    },
  });

  return NextResponse.json(canvas, { status: 201 });
});
