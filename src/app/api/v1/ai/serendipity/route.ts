import { NextResponse } from "next/server";
import { withAuthValidation } from "@/lib/api/route-handler";
import { serendipitySchema } from "@/lib/validation/ai";
import { findSerendipitousItems } from "@/lib/ai/serendipity-service";
import { prisma } from "@/lib/db";
import { forbiddenError } from "@/lib/errors";
import { runBudgetedAi } from "@/lib/ai/budget";

export const POST = withAuthValidation(
  serendipitySchema,
  async ({ canvasId, keywords }, _req, session) => {
    const owned = await prisma.canvas.findFirst({
      where: { id: canvasId, userId: session.user.id },
      select: { id: true },
    });
    if (!owned)
      throw forbiddenError("Shared-canvas AI is disabled for launch.");
    const safeKeywords = keywords || [];
    const budgeted = await runBudgetedAi(
      session.user.id,
      { prompt: safeKeywords.join("\n") || "serendipity", maxOutputTokens: 1 },
      () =>
        findSerendipitousItems(
          session.user.id,
          canvasId,
          safeKeywords,
          session.user.email || undefined,
        ),
    );

    return NextResponse.json({
      results: budgeted.value,
      usage: budgeted.usage,
    });
  },
);
