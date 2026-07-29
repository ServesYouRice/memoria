/**
 * Canvas Item Comments API
 * Handles creating and listing comments on canvas items
 */

import { type NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { z } from "zod";
import {
  NotFoundError,
  UnauthorizedError,
  ValidationError,
} from "@/lib/errors";
import { sanitizeComment } from "@/lib/sanitization";
import { errorResponse } from "@/lib/errors";
import { ActivityType, logActivity } from "@/lib/activity";

interface RouteContext {
  params: Promise<{ itemId: string }>;
}

const createCommentSchema = z.object({
  content: z
    .string()
    .min(1, "Comment cannot be empty")
    .max(5000, "Comment too long")
    .transform((val) => sanitizeComment(val)),
});

const commentUserSelect = {
  id: true,
  name: true,
  image: true,
} as const;

function parsePaginationParam(
  value: string | null,
  fallback: number,
  max: number,
) {
  if (!value) {
    return fallback;
  }

  const parsed = Number.parseInt(value, 10);
  if (Number.isNaN(parsed)) {
    return fallback;
  }

  return Math.min(Math.max(parsed, 0), max);
}

/**
 * POST /api/v1/items/[itemId]/comments
 * Create a new comment on a canvas item
 */
export async function POST(request: NextRequest, { params }: RouteContext) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      throw new UnauthorizedError("You must be logged in to comment");
    }

    const { itemId } = await params;

    // Validate request body
    const body = await request.json();
    const validation = createCommentSchema.safeParse(body);
    if (!validation.success) {
      throw new ValidationError(
        validation.error.errors[0]?.message || "Validation error",
      );
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
      throw new NotFoundError("Canvas item not found");
    }

    // Check if user has access to the canvas
    const isOwner = item.canvas.userId === session.user.id;
    const hasShare = item.canvas.shares.some(
      (share) =>
        share.recipientId === session.user.id &&
        ["COMMENT", "EDIT"].includes(share.role),
    );

    if (!isOwner && !hasShare) {
      throw new UnauthorizedError(
        "You do not have permission to comment on this item",
      );
    }

    // For shared users, check they have COMMENT or EDIT role
    if (!isOwner && hasShare) {
      const userShare = item.canvas.shares.find(
        (share) => share.recipientId === session.user.id,
      );
      if (userShare && userShare.role === "VIEW") {
        throw new UnauthorizedError(
          "You only have view permission on this canvas",
        );
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
          select: commentUserSelect,
        },
      },
    });

    await logActivity({
      userId: session.user.id,
      type: ActivityType.COMMENT_ADDED,
      canvasId: item.canvasId,
      canvasName: item.canvas.name,
      itemId,
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
    const { itemId } = await params;

    // Parse pagination params
    const { searchParams } = new URL(request.url);
    const limit = parsePaginationParam(searchParams.get("limit"), 50, 100);
    const offset = parsePaginationParam(
      searchParams.get("offset"),
      0,
      Number.MAX_SAFE_INTEGER,
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
      throw new NotFoundError("Canvas item not found");
    }

    // Check if user has access (owner, shared, or public)
    const isOwner = session?.user?.id && item.canvas.userId === session.user.id;
    const hasShare = Boolean(
      session?.user?.id &&
      item.canvas.shares.some((share) => share.recipientId === session.user.id),
    );
    const isPublic = item.canvas.isPublic;

    if (!isOwner && !hasShare && !isPublic) {
      throw new UnauthorizedError(
        "You do not have permission to view this item",
      );
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
            select: commentUserSelect,
          },
        },
        orderBy: {
          createdAt: "asc",
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
