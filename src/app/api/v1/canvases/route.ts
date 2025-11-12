import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/api/auth';
import { prisma } from '@/lib/db';
import { z } from 'zod';

/**
 * GET /api/v1/canvases
 *
 * Fetch all canvases for the authenticated user
 * Per ADR-0001: API Versioning & Error Contract (RFC 7807)
 */
export async function GET() {
  try {
    const { userId } = await requireAuth();

    // Fetch all canvases for the user
    const canvases = await prisma.canvas.findMany({
      where: {
        userId,
      },
      orderBy: {
        updatedAt: 'desc',
      },
    });

    return NextResponse.json(canvases);
  } catch (error) {
    console.error('Error fetching canvases:', error);
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
    const { userId } = await requireAuth();

    // Parse and validate request body
    const body = await request.json();
    const validatedData = createCanvasSchema.parse(body);

    // Create canvas
    const canvas = await prisma.canvas.create({
      data: {
        name: validatedData.name,
        userId,
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

    console.error('Error creating canvas:', error);
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
