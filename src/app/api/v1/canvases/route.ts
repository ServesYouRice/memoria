import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { z } from 'zod';
import { DEFAULT_PAGE_LIMIT, MAX_PAGE_LIMIT } from '@/lib/constants';
import { createLogger } from '@/lib/logger';

const logger = createLogger('api:canvases');

/**
 * GET /api/v1/canvases
 *
 * Fetch canvases for the authenticated user
 * Per ADR-0001: API Versioning & Error Contract (RFC 7807)
 *
 * Query parameters:
 * - limit: Number of canvases to return (default: 50, max: 100)
 * - offset: Number of canvases to skip (default: 0)
 *
 * FIXED: Issue #16 - Added pagination limits
 */
export async function GET(request: NextRequest) {
  let session = null; // Declare outside try block to fix scope issue

  try {
    // Authentication check
    session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json(
        {
          type: 'https://canvascollect.com/errors/unauthorized',
          title: 'Unauthorized',
          status: 401,
          detail: 'You must be logged in to access this resource',
        },
        { status: 401 }
      );
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
  } catch (error) {
    // FIXED: Variable scope - session now accessible in catch block
    logger.error({ error, userId: session?.user?.id }, 'Error fetching canvases');
    return NextResponse.json(
      {
        type: 'https://canvascollect.com/errors/internal-error',
        title: 'Internal Server Error',
        status: 500,
        detail: 'An unexpected error occurred',
      },
      { status: 500 }
    );
  }
}

const createCanvasSchema = z.object({
  name: z.string().min(1).max(255).optional().default('Untitled Canvas'),
});

/**
 * POST /api/v1/canvases
 *
 * Create a new canvas for the authenticated user
 * Per ADR-0001: API Versioning & Error Contract (RFC 7807)
 */
export async function POST(request: Request) {
  try {
    // Authentication check
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json(
        {
          type: 'https://canvascollect.com/errors/unauthorized',
          title: 'Unauthorized',
          status: 401,
          detail: 'You must be logged in to access this resource',
        },
        { status: 401 }
      );
    }

    // Parse and validate request body
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
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        {
          type: 'https://canvascollect.com/errors/validation-error',
          title: 'Validation Error',
          status: 400,
          detail: 'Invalid request data',
          errors: error.errors.map((err) => ({
            field: err.path.join('.'),
            message: err.message,
          })),
        },
        { status: 400 }
      );
    }

    logger.error({ error, userId: session?.user?.id }, 'Error creating canvas');
    return NextResponse.json(
      {
        type: 'https://canvascollect.com/errors/internal-error',
        title: 'Internal Server Error',
        status: 500,
        detail: 'An unexpected error occurred',
      },
      { status: 500 }
    );
  }
}
