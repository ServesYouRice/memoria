import { type NextRequest, NextResponse } from 'next/server';
import { requireAuth, requireCanvasAccess } from '@/lib/api/auth';
import { prisma } from '@/lib/db';
import { z } from 'zod';
import { withApiHandler } from '@/lib/api/route-handler';
import { NotFoundError } from '@/lib/errors';

interface RouteParams {
    params: Promise<{ canvasId: string; connectionId: string }>;
}

const updateConnectionSchema = z.object({
    label: z.string().max(100).optional(),
    style: z.enum(['SOLID', 'DASHED', 'DOTTED']).optional(),
});

/**
 * PATCH /api/v1/canvases/:canvasId/connections/:connectionId
 *
 * Update a connection
 */
export const PATCH = withApiHandler(async (request: NextRequest, { params }: RouteParams) => {
    const { userId, email } = await requireAuth();
    const { canvasId, connectionId } = await params;

    await requireCanvasAccess(canvasId, userId, email, 'EDIT');

    const existing = await prisma.itemConnection.findFirst({
        where: { id: connectionId, canvasId },
    });

    if (!existing) {
        throw new NotFoundError('Connection not found');
    }

    const body = await request.json();
    const updates = updateConnectionSchema.parse(body);

    const connection = await prisma.itemConnection.update({
        where: { id: connectionId },
        data: updates,
    });

    return NextResponse.json({
        id: connection.id,
        fromId: connection.fromId,
        toId: connection.toId,
        label: connection.label,
        style: connection.style,
        createdAt: connection.createdAt.toISOString(),
    });
});

/**
 * DELETE /api/v1/canvases/:canvasId/connections/:connectionId
 *
 * Delete a connection
 */
export const DELETE = withApiHandler(async (_request: NextRequest, { params }: RouteParams) => {
    const { userId, email } = await requireAuth();
    const { canvasId, connectionId } = await params;

    await requireCanvasAccess(canvasId, userId, email, 'EDIT');

    const existing = await prisma.itemConnection.findFirst({
        where: { id: connectionId, canvasId },
    });

    if (!existing) {
        throw new NotFoundError('Connection not found');
    }

    await prisma.itemConnection.delete({
        where: { id: connectionId },
    });

    return NextResponse.json({ success: true });
});
