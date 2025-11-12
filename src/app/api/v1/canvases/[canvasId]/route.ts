import { NextResponse } from 'next/server';
import { requireAuth, requireCanvasOwnership } from '@/lib/api/auth';
import { prisma } from '@/lib/db';
import { logger } from '@/lib/logger';
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
    const { userId } = await requireAuth();
    const { canvasId } = params;

    // Verify canvas ownership
    await requireCanvasOwnership(canvasId, userId);

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

    logger.error({ error, canvasId: params.canvasId }, 'Error updating canvas');
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
