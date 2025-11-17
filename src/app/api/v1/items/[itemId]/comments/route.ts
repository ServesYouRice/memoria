/**
 * Canvas Item Comments API
 * Handles creating and listing comments on canvas items
 */

import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { z } from 'zod';
import { NotFoundError, UnauthorizedError, ValidationError } from '@/lib/errors';
import { sanitizeComment } from '@/lib/sanitization';
import { errorResponse } from '@/lib/api/error-handler';
import type { CanvasShare } from '@prisma/client';

interface RouteContext {
  params: { itemId: string };
}

const createCommentSchema = z.object({
  content: z
    .string()
    .min(1, 'Comment cannot be empty')
    .max(5000, 'Comment too long')
    .transform((val) => sanitizeComment(val)),
});

/**
 * POST /api/v1/items/[itemId]/comments
 * Create a new comment on a canvas item
 */
export async function POST(request: NextRequest, { params }: RouteContext) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      throw new UnauthorizedError('You must be logged in to comment');
    }

    const { itemId } = params;

    // Validate request body
    const body = await request.json();
    const validation = createCommentSchema.safeParse(body);
    if (!validation.success) {
      throw new ValidationError(validation.error.errors[0].message);
    }

    const { content } = validation.data;

    // Check if item exists and user has access (via ownership or share)
    const item = await prisma.canvasItem.findUnique({
      where: { id: itemId },
      include: {
        canvas: {
          include: {
            user: true,
            shares: true,
          },
        },
      },
    });

    if (!item || item.deletedAt) {
      throw new NotFoundError('Canvas item not found');
    }

    // Check if user has access to the canvas
    const isOwner = item.canvas.userId === session.user.id;
    const hasShare = item.canvas.shares.some(
      (share: CanvasShare) => share.email === session.user.email && ['COMMENT', 'EDIT'].includes(share.role)
    );
    const isPublic = item.canvas.isPublic;

    if (!isOwner && !hasShare && !isPublic) {
      throw new UnauthorizedError('You do not have permission to comment on this item');
    }

    // For shared users, check they have COMMENT or EDIT role
    if (!isOwner && hasShare) {
      const userShare = item.canvas.shares.find((share: CanvasShare) => share.email === session.user.email);
      if (userShare && userShare.role === 'VIEW') {
        throw new UnauthorizedError('You only have view permission on this canvas');
      }
    }

    // Create the comment
    const comment = await prisma.comment.create({
      data: {
        itemId,
        userId: session.user.id,
        content,
      },
      include: {
        user: {
          select: {
            id: true,
            name: true,
            email: true,
            image: true,
          },
        },
      },
    });

    return NextResponse.json(comment, { status: 201 });
  } catch (error) {
    return errorResponse(error, request.url);
  }
}

/**
 * GET /api/v1/items/[itemId]/comments
 * List all comments for a canvas item with pagination
 * Query params: limit (default 50, max 100), offset (default 0)
 */
export async function GET(request: NextRequest, { params }: RouteContext) {
  try {
    const session = await auth();
    const { itemId } = params;

    // Parse pagination params
    const { searchParams } = new URL(request.url);
    const limit = Math.min(
      parseInt(searchParams.get('limit') || '50', 10),
      100
    );
    const offset = Math.max(
      parseInt(searchParams.get('offset') || '0', 10),
      0
    );

    // Check if item exists
    const item = await prisma.canvasItem.findUnique({
      where: { id: itemId },
      include: {
        canvas: {
          include: {
            user: true,
            shares: true,
          },
        },
      },
    });

    if (!item || item.deletedAt) {
      throw new NotFoundError('Canvas item not found');
    }

    // Check if user has access (owner, shared, or public)
    const isOwner = session?.user?.id && item.canvas.userId === session.user.id;
    const hasShare = session?.user?.email && item.canvas.shares.some(
      (share: CanvasShare) => share.email === session.user.email
    );
    const isPublic = item.canvas.isPublic;

    if (!isOwner && !hasShare && !isPublic) {
      throw new UnauthorizedError('You do not have permission to view this item');
    }

    // Fetch comments with pagination
    const [comments, total] = await Promise.all([
      prisma.comment.findMany({
        where: {
          itemId,
          deletedAt: null,
        },
        include: {
          user: {
            select: {
              id: true,
              name: true,
              email: true,
              image: true,
            },
          },
        },
        orderBy: {
          createdAt: 'asc',
        },
        take: limit,
        skip: offset,
      }),
      prisma.comment.count({
        where: {
          itemId,
          deletedAt: null,
        },
      }),
    ]);

    return NextResponse.json({
      comments,
      pagination: {
        total,
        limit,
        offset,
        hasMore: offset + limit < total,
      },
    });
  } catch (error) {
    return errorResponse(error, request.url);
  }
}
