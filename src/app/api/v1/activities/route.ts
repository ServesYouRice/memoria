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
      activities,
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
