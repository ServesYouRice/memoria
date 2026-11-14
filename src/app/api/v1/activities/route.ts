/**
 * Activities API
 * Fetch user activity feed
 */

import { type NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/api/auth";
import { prisma } from "@/lib/db";
import { errorResponse } from "@/lib/errors";
import { parsePagination } from "@/lib/api/pagination";

/**
 * IMP-138: older rows were stored without the canvas name. Fill it in with
 * one lookup, limited to canvases the caller owns or that are shared with
 * them; a deleted or unreachable canvas stays without a name.
 */
async function fillCanvasNames<
  T extends { canvasId: string | null; canvasName: string | null },
>(activities: T[], userId: string): Promise<T[]> {
  const missing = [
    ...new Set(
      activities
        .filter((activity) => activity.canvasId && !activity.canvasName)
        .map((activity) => activity.canvasId as string),
    ),
  ];
  if (missing.length === 0) return activities;

  const canvases = await prisma.canvas.findMany({
    where: {
      id: { in: missing },
      OR: [{ userId }, { shares: { some: { recipientId: userId } } }],
    },
    select: { id: true, name: true },
  });
  const names = new Map(canvases.map((canvas) => [canvas.id, canvas.name]));
  return activities.map((activity) =>
    activity.canvasId && !activity.canvasName && names.has(activity.canvasId)
      ? { ...activity, canvasName: names.get(activity.canvasId) ?? null }
      : activity,
  );
}

/**
 * GET /api/v1/activities
 * Fetch recent activities for the current user
 */
export async function GET(request: NextRequest) {
  try {
    const { userId } = await requireAuth();

    const { searchParams } = new URL(request.url);
    const { limit, offset } = parsePagination(searchParams, {
      defaultLimit: 50,
      maxLimit: 100,
    });
    const canvasId = searchParams.get("canvasId");

    const where: Record<string, unknown> = {
      userId,
    };

    if (canvasId) {
      where["canvasId"] = canvasId;
    }

    const [activities, total] = await Promise.all([
      prisma.activity.findMany({
        where,
        orderBy: {
          createdAt: "desc",
        },
        take: limit,
        skip: offset,
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
      }),
      prisma.activity.count({ where }),
    ]);

    return NextResponse.json({
      activities: await fillCanvasNames(activities, userId),
      pagination: {
        total,
        limit,
        offset,
        hasMore: offset + activities.length < total,
      },
    });
  } catch (error) {
    return errorResponse(error, request.url);
  }
}
