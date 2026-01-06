import { type NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/api/auth';
import { prisma } from '@/lib/db';
import { z } from 'zod';
import { DEFAULT_PAGE_LIMIT, MAX_PAGE_LIMIT } from '@/lib/constants';
import { withApiHandler } from '@/lib/api/route-handler';

/**
 * GET /api/v1/workspaces
 *
 * Fetch workspaces for the authenticated user
 */
export const GET = withApiHandler(async (request: NextRequest) => {
    const { userId } = await requireAuth();

    const { searchParams } = new URL(request.url);
    const limit = Math.min(
        parseInt(searchParams.get('limit') || String(DEFAULT_PAGE_LIMIT), 10),
        MAX_PAGE_LIMIT
    );
    const offset = parseInt(searchParams.get('offset') || '0', 10);

    const where = { userId };

    const total = await prisma.workspace.count({ where });

    const workspaces = await prisma.workspace.findMany({
        where,
        orderBy: { updatedAt: 'desc' },
        take: limit,
        skip: offset,
        include: {
            _count: {
                select: { canvases: true },
            },
        },
    });

    return NextResponse.json({
        workspaces: workspaces.map((w) => ({
            id: w.id,
            name: w.name,
            canvasCount: w._count.canvases,
            createdAt: w.createdAt.toISOString(),
            updatedAt: w.updatedAt.toISOString(),
        })),
        pagination: {
            total,
            limit,
            offset,
            hasMore: offset + limit < total,
        },
    });
});

const createWorkspaceSchema = z.object({
    name: z.string().min(1, 'Workspace name is required').max(100, 'Name too long'),
});

/**
 * POST /api/v1/workspaces
 *
 * Create a new workspace
 */
export const POST = withApiHandler(async (request: NextRequest) => {
    const { userId } = await requireAuth();

    const body = await request.json();
    const { name } = createWorkspaceSchema.parse(body);

    const workspace = await prisma.workspace.create({
        data: {
            name,
            userId,
        },
    });

    return NextResponse.json(
        {
            id: workspace.id,
            name: workspace.name,
            canvasCount: 0,
            createdAt: workspace.createdAt.toISOString(),
            updatedAt: workspace.updatedAt.toISOString(),
        },
        { status: 201 }
    );
});
