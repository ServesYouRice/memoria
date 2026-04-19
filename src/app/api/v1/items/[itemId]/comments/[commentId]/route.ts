import { type NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { sanitizeComment } from "@/lib/sanitization";
import { z } from "zod";

import { withApiHandler } from "@/lib/api/route-handler";
import {
  notFoundError,
  forbiddenError,
  unauthorizedError,
  ValidationError,
} from "@/lib/errors";

// const _logger = createLogger('comments-api');

const updateCommentSchema = z.object({
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

interface RouteContext {
  params: Promise<{ itemId: string; commentId: string }>;
}

async function getCommentWithAccess(
  commentId: string,
  itemId: string,
  userId: string,
  userEmail?: string | null,
) {
  const comment = await prisma.comment.findUnique({
    where: { id: commentId },
    include: {
      item: {
        include: {
          canvas: {
            include: {
              shares: true,
            },
          },
        },
      },
      user: {
        select: commentUserSelect,
      },
    },
  });

  if (!comment || comment.deletedAt || comment.itemId !== itemId) {
    throw notFoundError("Comment", commentId);
  }

  const isOwner = comment.item.canvas.userId === userId;
  const isAuthor = comment.userId === userId;
  const hasShare =
    !!userEmail &&
    comment.item.canvas.shares.some(
      (share) => share.email === userEmail.toLowerCase(),
    );

  if (!isOwner && !isAuthor && !hasShare && !comment.item.canvas.isPublic) {
    throw forbiddenError();
  }

  return { comment, isOwner, isAuthor };
}

export const GET = withApiHandler(
  async (_req: NextRequest, { params }: RouteContext) => {
    const session = await auth();
    if (!session?.user?.id) {
      throw unauthorizedError();
    }

    const { commentId, itemId } = await params;

    const { comment } = await getCommentWithAccess(
      commentId,
      itemId,
      session.user.id,
      session.user.email,
    );

    return NextResponse.json(comment);
  },
);

export const PATCH = withApiHandler(
  async (req: NextRequest, { params }: RouteContext) => {
    const session = await auth();
    if (!session?.user?.id) {
      throw unauthorizedError();
    }
    const { itemId, commentId } = await params;

    const body = await req.json();
    const validation = updateCommentSchema.safeParse(body);
    if (!validation.success) {
      throw new ValidationError(
        validation.error.errors[0]?.message || "Validation error",
      );
    }

    const { comment, isOwner, isAuthor } = await getCommentWithAccess(
      commentId,
      itemId,
      session.user.id,
      session.user.email,
    );

    if (!isOwner && !isAuthor) {
      throw forbiddenError();
    }

    const updated = await prisma.comment.update({
      where: { id: comment.id },
      data: {
        content: validation.data.content,
      },
      include: {
        user: {
          select: commentUserSelect,
        },
      },
    });

    return NextResponse.json(updated);
  },
);

export const DELETE = withApiHandler(
  async (_req: NextRequest, { params }: RouteContext) => {
    const session = await auth();
    if (!session?.user?.id) {
      throw unauthorizedError();
    }
    const { itemId, commentId } = await params;

    const { comment, isOwner, isAuthor } = await getCommentWithAccess(
      commentId,
      itemId,
      session.user.id,
      session.user.email,
    );

    if (!isOwner && !isAuthor) {
      throw forbiddenError();
    }

    await prisma.comment.update({
      where: { id: comment.id },
      data: {
        deletedAt: new Date(),
      },
    });

    return NextResponse.json({ success: true });
  },
);
