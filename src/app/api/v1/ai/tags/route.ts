import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { TAG_SYSTEM_PROMPT, generateTags } from "@/lib/ai/service";
import { withAuthValidation } from "@/lib/api/route-handler";
import { tagSchema } from "@/lib/validation/ai";
import { runBudgetedAi } from "@/lib/ai/budget";
import { withTaggingRules } from "@/lib/ai/tagging-rules";

export const POST = withAuthValidation(
  tagSchema,
  async ({ content }, _request, session) => {
    // IMP-106: the person's own tagging rules go with every request, and
    // count against the same prompt cap as the content.
    const user = await prisma.user.findUnique({
      where: { id: session.user.id },
      select: { taggingRules: true },
    });
    const taggingRules = user?.taggingRules ?? null;
    const system = withTaggingRules(TAG_SYSTEM_PROMPT, taggingRules);
    const budgeted = await runBudgetedAi(
      session.user.id,
      { prompt: `${system}\n${content}`, maxOutputTokens: 80 },
      () => generateTags(content, session.user.id, taggingRules),
    );
    return NextResponse.json({ tags: budgeted.value, usage: budgeted.usage });
  },
);
