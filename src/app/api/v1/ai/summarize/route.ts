import { NextResponse } from "next/server";
import { summarizeCanvas } from "@/lib/ai/service";
import { prisma } from "@/lib/db";
import { withAuthValidation } from "@/lib/api/route-handler";
import { summarizeSchema } from "@/lib/validation/ai";
import { forbiddenError, notFoundError } from "@/lib/errors";

export const POST = withAuthValidation(
  summarizeSchema,
  async ({ canvasId }, _req, session) => {
    const email = session.user.email?.toLowerCase() || "";
    const canvas = await prisma.canvas.findUnique({
      where: { id: canvasId },
      include: {
        items: { where: { deletedAt: null } },
        shares: {
          where: { email },
          select: { id: true },
        },
      },
    });

    if (!canvas) {
      throw notFoundError("Canvas", canvasId);
    }

    // Basic permission check - owner or shared (simplified for now)
    if (
      canvas.userId !== session.user.id &&
      canvas.shares.length === 0 &&
      !canvas.isPublic
    ) {
      throw forbiddenError();
    }

    const summary = await summarizeCanvas(canvas.items);

    return NextResponse.json({ summary });
  },
);
