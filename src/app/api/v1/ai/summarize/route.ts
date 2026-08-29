import { NextResponse } from "next/server";
import {
  AI_SUMMARY_ITEM_LIMIT,
  buildCanvasSummaryContent,
  summarizeCanvas,
} from "@/lib/ai/service";
import { runBudgetedAi } from "@/lib/ai/budget";
import { prisma } from "@/lib/db";
import { withAuthValidation } from "@/lib/api/route-handler";
import { summarizeSchema } from "@/lib/validation/ai";
import { forbiddenError, notFoundError } from "@/lib/errors";

export const POST = withAuthValidation(
  summarizeSchema,
  async ({ canvasId }, _req, session) => {
    const canvas = await prisma.canvas.findUnique({
      where: { id: canvasId },
      select: {
        id: true,
        userId: true,
        items: {
          where: {
            deletedAt: null,
            type: { in: ["NOTE", "TEXT", "BOOKMARK"] },
          },
          orderBy: [{ zIndex: "asc" }, { id: "asc" }],
          take: AI_SUMMARY_ITEM_LIMIT,
          select: { type: true, content: true },
        },
      },
    });

    if (!canvas) {
      throw notFoundError("Canvas", canvasId);
    }

    if (canvas.userId !== session.user.id) {
      throw forbiddenError();
    }

    const prompt = buildCanvasSummaryContent(canvas.items);
    const budgeted = await runBudgetedAi(
      session.user.id,
      { prompt, maxOutputTokens: 500 },
      () => summarizeCanvas(canvas.items),
    );

    return NextResponse.json({
      summary: budgeted.value,
      usage: budgeted.usage,
      itemsConsumed: canvas.items.length,
    });
  },
);
