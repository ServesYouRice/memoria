import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { z } from 'zod';

const updateCanvasSchema = z.object({
  name: z.string().min(1).max(255).optional(),
  zoomLevel: z.number().min(0.1).max(5).optional(),
  panX: z.number().optional(),
  panY: z.number().optional(),
});

/**
 * PATCH /api/v1/canvases/[canvasId]
 *
 * Update canvas properties (name, zoom, pan)
 * Per ADR-0001: API Versioning & Error Contract (RFC 7807)
 */
export async function PATCH(
  request: Request,
  { params }: { params: { canvasId: string } }
) {
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

    const { canvasId } = params;

    // Verify canvas ownership
    const canvas = await prisma.canvas.findUnique({
      where: { id: canvasId },
      select: { userId: true },
    });

    if (!canvas) {
      return NextResponse.json(
        {
          type: 'https://canvascollect.com/errors/not-found',
          title: 'Not Found',
          status: 404,
          detail: 'Canvas not found',
        },
        { status: 404 }
      );
    }

    if (canvas.userId !== session.user.id) {
      return NextResponse.json(
        {
          type: 'https://canvascollect.com/errors/forbidden',
          title: 'Forbidden',
          status: 403,
          detail: 'You do not have permission to update this canvas',
        },
        { status: 403 }
      );
    }

    // Parse and validate request body
    const body = await request.json();
    const validatedData = updateCanvasSchema.parse(body);

    // Update canvas
    const updatedCanvas = await prisma.canvas.update({
      where: { id: canvasId },
      data: validatedData,
    });

    return NextResponse.json(updatedCanvas);
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

    console.error('Error updating canvas:', error);
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
