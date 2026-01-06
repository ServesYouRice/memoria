import { type NextRequest, NextResponse } from 'next/server';
import { requireAuth, requireCanvasAccess } from '@/lib/api/auth';
import { prisma } from '@/lib/db';
import { z } from 'zod';
import { withApiHandler } from '@/lib/api/route-handler';

interface RouteParams {
    params: Promise<{ canvasId: string }>;
}

/**
 * GET /api/v1/canvases/:canvasId/connections
 *
 * Get all connections for a canvas
 */
export const GET = withApiHandler(async (_request: NextRequest, { params }: RouteParams) => {
    const { userId, email } = await requireAuth();
    const { canvasId } = await params;

    await requireCanvasAccess(canvasId, userId, email, 'VIEW');

    const connections = await prisma.itemConnection.findMany({
        where: { canvasId },
        orderBy: { createdAt: 'asc' },
    });

    return NextResponse.json({
        connections: connections.map((c) => ({
            id: c.id,
            fromId: c.fromId,
            toId: c.toId,
            label: c.label,
            style: c.style,
            createdAt: c.createdAt.toISOString(),
        })),
    });
});

const createConnectionSchema = z.object({
    fromId: z.string().cuid(),
    toId: z.string().cuid(),
    label: z.string().max(100).optional(),
    style: z.enum(['SOLID', 'DASHED', 'DOTTED']).default('SOLID'),
});

/**
 * POST /api/v1/canvases/:canvasId/connections
 *
 * Create a new connection between items
 */
export const POST = withApiHandler(async (request: NextRequest, { params }: RouteParams) => {
    const { userId, email } = await requireAuth();
    const { canvasId } = await params;

    await requireCanvasAccess(canvasId, userId, email, 'EDIT');

    const body = await request.json();
    const data = createConnectionSchema.parse(body);

    // Verify both items exist and belong to this canvas
    const [fromItem, toItem] = await Promise.all([
        prisma.canvasItem.findFirst({
            where: { id: data.fromId, canvasId, deletedAt: null },
        }),
        prisma.canvasItem.findFirst({
            where: { id: data.toId, canvasId, deletedAt: null },
        }),
    ]);

    if (!fromItem || !toItem) {
        return NextResponse.json(
            { error: 'One or both items not found in this canvas' },
            { status: 400 }
        );
    }

    const connection = await prisma.itemConnection.create({
        data: {
            canvasId,
            fromId: data.fromId,
            toId: data.toId,
            label: data.label,
            style: data.style,
        },
    });

    return NextResponse.json(
        {
            id: connection.id,
            fromId: connection.fromId,
            toId: connection.toId,
            label: connection.label,
            style: connection.style,
            createdAt: connection.createdAt.toISOString(),
        },
        { status: 201 }
    );
});
