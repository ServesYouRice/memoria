import { NextResponse } from "next/server";
import { summarizeCanvas } from "@/lib/ai/service";
import { prisma } from "@/lib/db";
import { withAuthValidation } from "@/lib/api/route-handler";
import { summarizeSchema } from "@/lib/validation/ai";
import { forbiddenError, notFoundError } from "@/lib/errors";

export const POST = withAuthValidation(
  summarizeSchema,
  async ({ canvasId }, _req, session) => {
    const canvas = await prisma.canvas.findUnique({
      where: { id: canvasId },
      include: {
        items: { where: { deletedAt: null } },
      },
    });

    if (!canvas) {
      throw notFoundError("Canvas", canvasId);
    }

    if (canvas.userId !== session.user.id) {
      throw forbiddenError();
    }

    const summary = await summarizeCanvas(canvas.items);

    return NextResponse.json({ summary });
  },
);
