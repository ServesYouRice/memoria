import { NextResponse } from "next/server";
import { generateText } from "@/lib/ai/service";
import { withAuthValidation } from "@/lib/api/route-handler";
import { chatSchema } from "@/lib/validation/ai";
import { PERSONAS, type PersonaKey } from "@/lib/ai/personas";
import { runBudgetedAi } from "@/lib/ai/budget";

export const POST = withAuthValidation(
  chatSchema,
  async ({ message, context, persona }, _request, session) => {
    const personaDef = PERSONAS[persona as PersonaKey];
    // Add instruction to be concise and helpful
    const systemPrompt = `${personaDef.systemPrompt}\n\nUser Context:\n${context || "No specific context provided."}\n\nKeep responses concise and relevant to the canvas context.`;

    const budgeted = await runBudgetedAi(
      session.user.id,
      { prompt: `${systemPrompt}\n${message}`, maxOutputTokens: 500 },
      () =>
        generateText({
          prompt: message,
          system: systemPrompt,
          maxTokens: 500,
        }),
    );

    return NextResponse.json({ result: budgeted.value, usage: budgeted.usage });
  },
);
