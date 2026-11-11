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

  if (
    !comment ||
    comment.deletedAt ||
    comment.itemId !== itemId ||
    comment.item.deletedAt
  ) {
    throw notFoundError("Comment", commentId);
  }

  // Access follows the caller's current canvas access; authorship alone
  // grants nothing once a share is removed or downgraded.
  const isOwner = comment.item.canvas.userId === userId;
  const isAuthor = comment.userId === userId;
  const share = comment.item.canvas.shares.find(
    (entry) => entry.recipientId === userId,
  );

  if (!isOwner && !share && !comment.item.canvas.isPublic) {
    throw forbiddenError();
  }

  const canWrite =
    isOwner || (!!share && ["COMMENT", "EDIT"].includes(share.role));

  return { comment, isOwner, isAuthor, canWrite };
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
        validation.error.issues[0]?.message || "Validation error",
      );
    }

    const { comment, isAuthor, canWrite } = await getCommentWithAccess(
      commentId,
      itemId,
      session.user.id,
    );

    if (!isAuthor || !canWrite) {
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

    const { comment, isOwner, isAuthor, canWrite } = await getCommentWithAccess(
      commentId,
      itemId,
      session.user.id,
    );

    if (!isOwner && !(isAuthor && canWrite)) {
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
