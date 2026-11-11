import { NextResponse } from "next/server";
import { generateText } from "@/lib/ai/service";
import { withAuthValidation } from "@/lib/api/route-handler";
import { chatSchema } from "@/lib/validation/ai";
import { PERSONAS, type PersonaKey } from "@/lib/ai/personas";
import { runBudgetedAi } from "@/lib/ai/budget";
import { chatHistorySchema } from "@/lib/ai/chat-history";

// Earlier turns let follow-ups refer to the conversation the user sees.
const chatWithHistorySchema = chatSchema.extend({
  history: chatHistorySchema.optional(),
});

export const POST = withAuthValidation(
  chatWithHistorySchema,
  async ({ message, context, persona, history }, _request, session) => {
    const personaDef = PERSONAS[persona as PersonaKey];
    // Add instruction to be concise and helpful
    const systemPrompt = `${personaDef.systemPrompt}\n\nUser Context:\n${context || "No specific context provided."}\n\nKeep responses concise and relevant to the canvas context.`;

    const turns = history ?? [];
    // The reservation counts every turn the provider will read.
    const promptEstimate = [
      systemPrompt,
      ...turns.map((turn) => turn.content),
      message,
    ].join("\n");

    const budgeted = await runBudgetedAi(
      session.user.id,
      { prompt: promptEstimate, maxOutputTokens: 500 },
      () =>
        generateText({
          prompt: message,
          system: systemPrompt,
          maxTokens: 500,
          userId: session.user.id,
          ...(turns.length ? { history: turns } : {}),
        }),
    );

    return NextResponse.json({ result: budgeted.value, usage: budgeted.usage });
  },
);
