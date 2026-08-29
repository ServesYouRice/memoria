import { NextResponse } from "next/server";
import { generateTags } from "@/lib/ai/service";
import { withAuthValidation } from "@/lib/api/route-handler";
import { tagSchema } from "@/lib/validation/ai";
import { runBudgetedAi } from "@/lib/ai/budget";

export const POST = withAuthValidation(
  tagSchema,
  async ({ content }, _request, session) => {
    const budgeted = await runBudgetedAi(
      session.user.id,
      { prompt: content, maxOutputTokens: 80 },
      () => generateTags(content),
    );
    return NextResponse.json({ tags: budgeted.value, usage: budgeted.usage });
  },
);
