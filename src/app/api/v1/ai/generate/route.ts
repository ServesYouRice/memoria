import { NextResponse } from "next/server";
import { generateText } from "@/lib/ai/service";
import { withAuthValidation } from "@/lib/api/route-handler";
import { generateSchema } from "@/lib/validation/ai";
import { runBudgetedAi } from "@/lib/ai/budget";

export const POST = withAuthValidation(
  generateSchema,
  async ({ prompt, system, temperature }, _request, session) => {
    const budgeted = await runBudgetedAi(
      session.user.id,
      { prompt: `${system || ""}\n${prompt}`, maxOutputTokens: 500 },
      () => generateText({ prompt, system, temperature, maxTokens: 500 }),
    );
    return NextResponse.json({ result: budgeted.value, usage: budgeted.usage });
  },
);
