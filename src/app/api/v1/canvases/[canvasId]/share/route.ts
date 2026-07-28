/**
 * Canvas Sharing API
 * POST /api/v1/canvases/[canvasId]/share - Share canvas with someone
 * GET /api/v1/canvases/[canvasId]/share - List all shares
 */

import { type NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireAuth } from "@/lib/api/auth";
import { errorResponse, ForbiddenError } from "@/lib/errors";
import { z } from "zod";
import { assertCanvasShareCapacity } from "@/lib/policy/capacity";

const shareCanvasSchema = z.object({
  email: z.string().email("Invalid email address"),
  role: z.enum(["VIEW", "COMMENT", "EDIT"]).default("VIEW"),
});

interface RouteContext {
  params: Promise<{ canvasId: string }>;
}

/**
 * POST - Share canvas with someone
 */
export async function POST(request: NextRequest, { params }: RouteContext) {
  try {
    const { userId } = await requireAuth();
    const { canvasId } = await params;
    const body = await request.json();

    // Validate input
    const data = shareCanvasSchema.parse(body);

    // Check if user owns this canvas
    const canvas = await prisma.canvas.findUnique({
      where: { id: canvasId },
    });

    if (!canvas || canvas.userId !== userId) {
      throw new ForbiddenError(
        "You do not have permission to share this canvas",
      );
    }

    // Don't allow sharing with self
    const targetUser = await prisma.user.findUnique({
      where: { email: data.email.toLowerCase() },
    });

    const currentUser = await prisma.user.findUnique({
      where: { id: userId },
    });

    if (targetUser && currentUser && targetUser.id === currentUser.id) {
      throw new ForbiddenError("Cannot share canvas with yourself");
    }

    const normalizedEmail = data.email.toLowerCase();
    const share = await prisma.$transaction(async (tx) => {
      const existing = await tx.canvasShare.findUnique({
        where: { canvasId_email: { canvasId, email: normalizedEmail } },
        select: { id: true },
      });
      if (!existing) await assertCanvasShareCapacity(tx, canvasId);
      return tx.canvasShare.upsert({
        where: { canvasId_email: { canvasId, email: normalizedEmail } },
        create: { canvasId, email: normalizedEmail, role: data.role },
        update: { role: data.role },
      });
    });

    return NextResponse.json(share, { status: 201 });
  } catch (error) {
    return errorResponse(error, request.url);
  }
}

/**
 * GET - List all shares for this canvas
 */
export async function GET(request: NextRequest, { params }: RouteContext) {
  try {
    const { userId } = await requireAuth();
    const { canvasId } = await params;

    // Check if user owns this canvas
    const canvas = await prisma.canvas.findUnique({
      where: { id: canvasId },
    });

    if (!canvas || canvas.userId !== userId) {
      throw new ForbiddenError(
        "You do not have permission to view shares for this canvas",
      );
    }

    // Get all shares
    const shares = await prisma.canvasShare.findMany({
      where: { canvasId },
      orderBy: { createdAt: "desc" },
    });

    return NextResponse.json({ shares });
  } catch (error) {
    return errorResponse(error, request.url);
  }
}
