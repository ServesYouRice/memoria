/**
 * Shared Canvases API
 * GET /api/v1/shared-canvases - List canvases shared with the current user
 */

import { type NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { requireAuth } from "@/lib/api/auth";
import { errorResponse } from "@/lib/errors";
import { validatedJson } from "@/lib/api/response";
import { sharedCanvasResponseSchema } from "@/lib/api/response-schemas";

/**
 * GET - List canvases shared with the current user
 */
export async function GET(request: NextRequest) {
  try {
    const { userId } = await requireAuth();

    // Find all shares for this user's email
    const shares = await prisma.canvasShare.findMany({
      where: {
        recipientId: userId,
      },
      include: {
        canvas: {
          include: {
            user: {
              select: {
                name: true,
              },
            },
            _count: {
              select: {
                items: {
                  where: {
                    deletedAt: null,
                  },
                },
              },
            },
          },
        },
      },
      orderBy: {
        createdAt: "desc",
      },
    });

    // Transform to include role and owner info
    const sharedCanvases = shares.map((share) => ({
      id: share.canvas.id,
      name: share.canvas.name,
      thumbnailKey: share.canvas.thumbnailKey,
      thumbnailRevision: share.canvas.thumbnailRevision.toString(),
      itemCount: share.canvas._count.items,
      owner: share.canvas.user,
      role: share.role,
      sharedAt: share.createdAt,
      updatedAt: share.canvas.updatedAt,
    }));

    return validatedJson(sharedCanvasResponseSchema, { canvases: sharedCanvases });
  } catch (error) {
    return errorResponse(error, request.url);
  }
}
